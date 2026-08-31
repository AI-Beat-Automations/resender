import { headers } from "next/headers"

import { isAPIError } from "better-auth/api"

import { getAuth } from "@/lib/auth/auth"

// **El único lugar del repositorio que le habla al plugin `apiKey`.** Igual que
// `lib/auth/session.ts` con la sesión: los consumidores —las cinco rutas de la
// API externa, la pantalla de Ajustes y sus dos server actions— importan de acá
// y no de la librería, y este archivo es también el punto de mockeo de los
// tests.
//
// La forma que devuelve es deliberadamente la que ya consumían esos call sites
// cuando la implementación era propia (`lib/api-keys/api-keys.ts`, borrado en el
// escalón 3 de la ADR 0014): mismo `ApiKeyRecord`, mismo `{ id, tenantId }` al
// autenticar, mismo `InvalidApiKeyLabelError`. Nada del vocabulario del plugin
// —`referenceId`, `enabled`, `lastRequest`— sale de este archivo.

/** Prefijo visible de toda API key emitida. Ver [API Token] en CONTEXT.md. */
export const API_KEY_PREFIX = "pk_live_"

export type ApiKeyStatus = "active" | "revoked"

export type ApiKeyRecord = {
  id: string
  tenantId: string
  label: string
  visiblePrefix: string
  status: ApiKeyStatus
  createdAt: Date
  lastUsedAt: Date | null
}

export type AuthenticatedApiKey = {
  id: string
  tenantId: string
}

/** Por qué no vale la etiqueta. Código y no mensaje: el texto lo pone Ajustes,
 * que es quien sabe el idioma. */
export type ApiKeyLabelError = "label_required" | "label_too_long"

export class InvalidApiKeyLabelError extends Error {
  constructor(readonly code: ApiKeyLabelError) {
    super(code)
    this.name = "InvalidApiKeyLabelError"
  }
}

/**
 * Emite una key para el tenant y devuelve el secreto completo. **Es la única vez
 * que ese secreto existe**: en base queda solo su SHA-256 y a partir de acá la
 * lista muestra el prefijo visible y nada más.
 *
 * Se llama sin `headers`, así que el plugin la trata como llamada de servidor y
 * toma el dueño de `userId` en vez de la sesión de la cookie. El tenant lo
 * resuelve el server action contra `getSession()` antes de entrar acá, que es
 * donde tiene que resolverse.
 */
export async function createApiKey(tenantId: string, labelInput: unknown) {
  const label = normalizeLabel(labelInput)

  const created = await getAuth().api.createApiKey({
    body: { name: label, userId: tenantId },
  })

  return {
    apiKey: created.key,
    record: mapApiKey(created),
  }
}

/**
 * Las keys del tenant que tiene la sesión abierta, la más nueva primero.
 *
 * El endpoint del plugin resuelve el dueño **desde la cookie de sesión**, no de
 * un parámetro: por eso pide `headers` y por eso no hay forma de pedirle desde
 * la pantalla las keys de otro tenant. Es el mismo aislamiento que daba el
 * `where tenant_id = $1` de antes, movido un nivel más arriba.
 */
export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const { apiKeys } = await getAuth().api.listApiKeys({
    headers: await headers(),
  })

  return apiKeys
    .map(mapApiKey)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/**
 * Revoca una key **dentro del tenant que la emitió**: con un `apiKeyId` de otro
 * tenant el plugin responde NOT_FOUND y acá eso se traduce a `null`, que es lo
 * que Ajustes ya sabe mostrar como "no encontrada". Nunca 403: confirmar que ese
 * id existe es justo lo que no hay que decirle a quien prueba ids ajenos.
 *
 * Revocar es apagar `enabled`, no borrar la fila: la key revocada sigue en la
 * lista con su estado y deja de autenticar en la verificación siguiente
 * (CONTEXT.md → [Gestion de API keys en Settings]).
 */
export async function revokeApiKey(
  tenantId: string,
  apiKeyId: string
): Promise<ApiKeyRecord | null> {
  try {
    const updated = await getAuth().api.updateApiKey({
      body: { keyId: apiKeyId, userId: tenantId, enabled: false },
    })
    return mapApiKey(updated)
  } catch (error) {
    // Solo el "no existe / no es tuya" se convierte en `null`. Un fallo de base
    // tiene que seguir siendo un 500 y no un "no encontrada" silencioso.
    if (isAPIError(error) && error.status === "NOT_FOUND") return null
    throw error
  }
}

/**
 * Verifica el `Bearer` de la API externa y resuelve el tenant.
 *
 * **`tenantId` es `users.id`**, el mismo uuid con el que las cinco rutas filtran
 * páginas, conversaciones y mensajes. Del lado del plugin ese campo se llama
 * `referenceId` y está mapeado a la columna `user_id`; la traducción vive acá y
 * en ningún otro lado, porque equivocarla es que un tenant opere sobre los datos
 * de otro.
 *
 * Devuelve `null` para toda key que no autentica —inexistente, revocada,
 * malformada—: el contrato hacia afuera es un 401 sin detalle, igual que antes.
 * Los errores del plugin se traducen a ese `null` y no se propagan.
 */
export async function authenticateApiKey(
  apiKey: unknown
): Promise<AuthenticatedApiKey | null> {
  // Corte barato antes del round-trip: lo que no tiene el prefijo no es una key
  // de Resender y no hace falta ir a la base a comprobarlo.
  if (!isApiKeyFormat(apiKey)) return null

  const result = await getAuth().api.verifyApiKey({ body: { key: apiKey } })
  if (!result.valid || !result.key) return null

  return { id: result.key.id, tenantId: result.key.referenceId }
}

function isApiKeyFormat(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(API_KEY_PREFIX)
}

function normalizeLabel(labelInput: unknown) {
  const label = typeof labelInput === "string" ? labelInput.trim() : ""
  if (label.length < 1) {
    throw new InvalidApiKeyLabelError("label_required")
  }
  if (label.length > 80) {
    throw new InvalidApiKeyLabelError("label_too_long")
  }
  return label
}

// La forma del plugin traducida a la del producto. Los dos campos que no son un
// renombre directo:
//
//   - `status` sale de `enabled`, que es lo que el plugin apaga al revocar.
//   - `lastUsedAt` sale de `lastRequest`, que el plugin refresca en cada
//     verificación exitosa aun con el rate limit apagado.
//
// **No hay `revokedAt`.** El plugin no guarda cuándo se revocó una key y su
// `update` no toca `updated_at`, así que no existe ninguna columna de la que
// salga esa fecha sin inventarla. La lista dice que la key está revocada y no
// dice cuándo; el detalle está en la ADR 0014 y en el PR del escalón 3.
function mapApiKey(apiKey: {
  id: string
  name?: string | null
  start?: string | null
  referenceId: string
  enabled: boolean
  createdAt: Date | string
  lastRequest?: Date | string | null
}): ApiKeyRecord {
  return {
    id: apiKey.id,
    tenantId: apiKey.referenceId,
    label: apiKey.name ?? "",
    visiblePrefix: apiKey.start ?? API_KEY_PREFIX,
    status: apiKey.enabled ? "active" : "revoked",
    createdAt: new Date(apiKey.createdAt),
    lastUsedAt: apiKey.lastRequest ? new Date(apiKey.lastRequest) : null,
  }
}
