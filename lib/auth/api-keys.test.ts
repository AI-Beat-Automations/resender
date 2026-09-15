import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { apiKeyPlugin } from "@/lib/auth/auth"

// **La resolución de tenant es lo que este test existe para proteger.**
//
// Del lado del plugin el dueño de una key se llama `referenceId` y vive en la
// columna `user_id`; del lado del producto se llama `tenantId` y es el `users.id`
// uuid con el que las cinco rutas de la API externa filtran páginas,
// conversaciones y mensajes. Esa traducción vive en `lib/auth/api-keys.ts` y en
// ningún otro lado: escribirla al revés no rompe nada visible, simplemente hace
// que un tenant opere sobre los datos de otro.
//
// Corre contra una instancia **real** de Better Auth con el adaptador en
// memoria, sin base de datos, y con `apiKeyPlugin()` —la misma configuración que
// usa el Worker, no una copia—. Así el test cubre también lo que esa
// configuración promete: que el prefijo visible sigue siendo `pk_live_` + 8 y
// que revocar apaga la key en vez de borrarla.

// El adaptador en memoria exige que las colecciones existan de antemano. La de
// las keys se llama `auth_api_keys` y no `apikey` porque el `modelName` del
// plugin ya está aplicado: es la primera cosa que este test verifica, sin
// proponérselo.
const db: Record<string, Record<string, unknown>[]> = {
  user: [],
  session: [],
  account: [],
  verification: [],
  auth_api_keys: [],
}

const auth = betterAuth({
  // Secreto de juguete a propósito: en `NODE_ENV=test` la librería solo
  // advierte, y lo que se prueba acá no es la criptografía sino el mapeo.
  secret: "test-secret-para-el-adaptador-en-memoria-0123456789",
  baseURL: "http://localhost:3000",
  database: memoryAdapter(db),
  emailAndPassword: { enabled: true },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  plugins: [apiKeyPlugin()],
})

// La misma configuración, pero con un adaptador que no contesta: es el blip de
// Neon del escenario real. `findOne` es lo único que toca `authenticateApiKey`
// al buscar el hash de la key, así que romperlo ahí rompe la verificación entera
// sin tocar nada más.
const brokenMemoryAdapter: ReturnType<typeof memoryAdapter> = (options) => ({
  ...memoryAdapter(db)(options),
  findOne: async () => {
    throw new Error("la base no contesta")
  },
})

const brokenAuth = betterAuth({
  secret: "test-secret-para-el-adaptador-en-memoria-0123456789",
  baseURL: "http://localhost:3000",
  database: brokenMemoryAdapter,
  emailAndPassword: { enabled: true },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  plugins: [apiKeyPlugin()],
})

// Mutable para que un solo test pueda cambiar la instancia bajo los pies del
// módulo, que es la única forma de ejercitar el fallo de base sin mockear el
// adaptador y dejar de probar el plugin real.
let currentAuth = auth

vi.mock("@/lib/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/auth")>()
  return { ...actual, getAuth: () => currentAuth }
})

// `next/headers` solo lo usa `listApiKeys`, que no se ejercita acá: listar pide
// una cookie de sesión y eso ya lo cubre el propio plugin. El mock existe para
// que importar el módulo no arrastre el runtime de request de Next.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))

const {
  ApiKeyVerificationFailedError,
  authenticateApiKey,
  createApiKey,
  revokeApiKey,
} = await import("@/lib/auth/api-keys")

let tenantId: string
let otherTenantId: string

beforeAll(async () => {
  // Por el alta pública y no por el adaptador interno: así los dos tenants
  // nacen con el mismo `users.id` que produce el registro real.
  const signUp = async (email: string) => {
    const { user } = await auth.api.signUpEmail({
      body: { email, password: "una-password-de-prueba", name: "Ada Lovelace" },
    })
    return user.id
  }

  tenantId = await signUp("tenant-1@example.com")
  otherTenantId = await signUp("tenant-2@example.com")
})

describe("authenticateApiKey", () => {
  it("devuelve el users.id del tenant que emitió la key", async () => {
    const created = await createApiKey(tenantId, "N8N producción")

    const authenticated = await authenticateApiKey(created.apiKey)

    expect(authenticated).toEqual({
      id: created.record.id,
      tenantId,
    })
    // El uuid, no el id de la key ni ningún otro identificador del plugin.
    expect(authenticated?.tenantId).toBe(tenantId)
    expect(authenticated?.tenantId).not.toBe(otherTenantId)
    expect(authenticated?.tenantId).not.toBe(created.record.id)
  })

  // Dos tenants, dos keys: cada una tiene que resolver la suya. Es el escenario
  // exacto en el que un mapeo mal escrito filtra datos entre cuentas.
  it("no cruza el tenant entre dos keys de dueños distintos", async () => {
    const mine = await createApiKey(tenantId, "mía")
    const theirs = await createApiKey(otherTenantId, "ajena")

    await expect(authenticateApiKey(mine.apiKey)).resolves.toMatchObject({
      tenantId,
    })
    await expect(authenticateApiKey(theirs.apiKey)).resolves.toMatchObject({
      tenantId: otherTenantId,
    })
  })

  // Lo contrario de lo que este test decía antes: verificar **no escribe**.
  // `verifyApiKey` del plugin refrescaba `last_used_at` en cada llamada y a
  // cincuenta envíos por segundo eso era un lock de fila por tenant. La columna
  // dejó de existir en el producto; si alguien vuelve a pasar por el plugin, el
  // valor deja de ser null y esto se pone rojo.
  it("verificar no escribe en la fila de la key", async () => {
    const created = await createApiKey(tenantId, "solo lectura")

    await authenticateApiKey(created.apiKey)

    const stored = db.auth_api_keys?.find((row) => row.id === created.record.id)
    expect(stored?.lastRequest ?? null).toBeNull()
    expect(stored?.requestCount ?? 0).toBe(0)
  })

  it("corta una key inventada, una vacía y algo que no es texto", async () => {
    await expect(
      authenticateApiKey("pk_live_inventadaperoconelprefijo")
    ).resolves.toBeNull()
    await expect(authenticateApiKey("")).resolves.toBeNull()
    await expect(authenticateApiKey(undefined)).resolves.toBeNull()
    await expect(authenticateApiKey({ key: "x" })).resolves.toBeNull()
  })

  // **El caso que este bloque existe para proteger.** Un blip de base durante
  // la lectura no puede salir como `401 unauthorized`: el operador se iría a
  // buscar una key revocada que nunca se revocó. Tiene que ser un 500, que es
  // lo que la ruta emite cuando esto propaga.
  //
  // El test corre contra el adaptador real de Better Auth con `findOne` roto,
  // que es exactamente lo que `authenticateApiKey` toca.
  it("propaga un fallo de base en vez de disfrazarlo de 401", async () => {
    const created = await createApiKey(tenantId, "victima del blip")

    currentAuth = brokenAuth
    try {
      await expect(authenticateApiKey(created.apiKey)).rejects.toBeInstanceOf(
        ApiKeyVerificationFailedError
      )
    } finally {
      currentAuth = auth
    }

    // Y la key nunca estuvo mal: con la base de vuelta autentica igual que antes.
    await expect(authenticateApiKey(created.apiKey)).resolves.toMatchObject({
      tenantId,
    })
  })

  // La otra mitad del corte: una key que de verdad no vale sigue siendo `null`.
  it("no confunde una key inexistente con un fallo de base", async () => {
    await expect(
      authenticateApiKey("pk_live_estanoexisteperotieneelprefijo")
    ).resolves.toBeNull()
  })

  // Y una revocada tampoco: `enabled` en falso es un 401 legítimo.
  it("no confunde una key revocada con un fallo de base", async () => {
    const created = await createApiKey(tenantId, "revocada, no rota")
    await revokeApiKey(tenantId, created.record.id)

    await expect(authenticateApiKey(created.apiKey)).resolves.toBeNull()
  })
})

describe("createApiKey", () => {
  // El contrato de [API Token] en CONTEXT.md: `pk_live_<secreto>`, y de eso la
  // lista solo muestra `pk_live_` + 8 caracteres.
  it("emite el secreto una vez y guarda solo el prefijo visible", async () => {
    const created = await createApiKey(tenantId, "etiqueta")

    expect(created.apiKey.startsWith("pk_live_")).toBe(true)
    expect(created.record.visiblePrefix).toBe(created.apiKey.slice(0, 16))
    expect(created.record.visiblePrefix).toHaveLength(16)
    // El registro que vuelve —el que dibuja la lista— no lleva el secreto.
    expect(JSON.stringify(created.record)).not.toContain(
      created.apiKey.slice(16)
    )
    expect(created.record.label).toBe("etiqueta")
    expect(created.record.status).toBe("active")
  })

  it("rechaza una etiqueta vacía y una de más de 80 caracteres", async () => {
    await expect(createApiKey(tenantId, "   ")).rejects.toMatchObject({
      code: "label_required",
    })
    await expect(createApiKey(tenantId, "x".repeat(81))).rejects.toMatchObject({
      code: "label_too_long",
    })
  })
})

describe("revokeApiKey", () => {
  it("deja la key en la lista y sin autenticar", async () => {
    const created = await createApiKey(tenantId, "para revocar")

    const revoked = await revokeApiKey(tenantId, created.record.id)

    expect(revoked?.status).toBe("revoked")
    // Sigue siendo la misma key, con su etiqueta y su prefijo: revocar la apaga,
    // no la borra.
    expect(revoked?.id).toBe(created.record.id)
    expect(revoked?.label).toBe("para revocar")
    await expect(authenticateApiKey(created.apiKey)).resolves.toBeNull()
  })

  // Una key solo se revoca dentro del tenant que la emitió. Sin esto, el id de
  // una key ajena —que es lo único que hace falta— apagaría la integración de
  // otra cuenta.
  it("no deja revocar la key de otro tenant", async () => {
    const created = await createApiKey(tenantId, "de tenant-1")

    await expect(
      revokeApiKey(otherTenantId, created.record.id)
    ).resolves.toBeNull()
    // Y sigue autenticando: el intento fallido no la tocó.
    await expect(authenticateApiKey(created.apiKey)).resolves.toMatchObject({
      tenantId,
    })
  })

  it("devuelve null para una key que no existe", async () => {
    await expect(revokeApiKey(tenantId, "no-existe")).resolves.toBeNull()
  })
})
