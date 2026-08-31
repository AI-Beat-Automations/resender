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

vi.mock("@/lib/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/auth")>()
  return { ...actual, getAuth: () => auth }
})

// `next/headers` solo lo usa `listApiKeys`, que no se ejercita acá: listar pide
// una cookie de sesión y eso ya lo cubre el propio plugin. El mock existe para
// que importar el módulo no arrastre el runtime de request de Next.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))

const { authenticateApiKey, createApiKey, revokeApiKey } =
  await import("@/lib/auth/api-keys")

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

  // `last_used_at` es lo que la lista de Ajustes muestra como último uso. El
  // plugin lo refresca en cada verificación **aunque el rate limit esté
  // apagado**; si eso dejara de pasar, la columna quedaría siempre en null y la
  // pantalla mentiría en silencio.
  it("marca el último uso al verificar", async () => {
    const created = await createApiKey(tenantId, "con uso")
    expect(created.record.lastUsedAt).toBeNull()

    await authenticateApiKey(created.apiKey)

    const revoked = await revokeApiKey(tenantId, created.record.id)
    expect(revoked?.lastUsedAt).toBeInstanceOf(Date)
  })

  it("corta una key inventada, una vacía y algo que no es texto", async () => {
    await expect(
      authenticateApiKey("pk_live_inventadaperoconelprefijo")
    ).resolves.toBeNull()
    await expect(authenticateApiKey("")).resolves.toBeNull()
    await expect(authenticateApiKey(undefined)).resolves.toBeNull()
    await expect(authenticateApiKey({ key: "x" })).resolves.toBeNull()
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
    expect(created.record.lastUsedAt).toBeNull()
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
