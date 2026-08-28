import type { ConnectedPage as MetaConnectedPage } from "@/lib/meta"
import { decryptSecret, encryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"

import type {
  HistorySyncStatus,
  WhatsappOnboardingMode,
} from "./connection-display"
import type { PageOwnershipRow } from "./page-selection"
import { normalizeWebhookUrl, type WebhookUrlError } from "./webhook-url"
import {
  encryptWebhookSigningSecret,
  generateWebhookSigningSecret,
} from "./webhook-signing"

export type PageStatus = "active" | "disconnected"
export type PageTokenStatus = "valid" | "invalid"

// `connected_pages` dejó de ser "páginas de Facebook" (migración 0013): ahora es
// cuentas conectadas, y `channel` es el discriminador. `meta_page_id` guarda el
// page id en Messenger, el IG ID de la cuenta profesional en Instagram y el
// `phone_number_id` en WhatsApp (migración 0017); el unique es
// `(channel, meta_page_id)`, así que **toda** búsqueda por `meta_page_id` tiene
// que decir de qué canal habla o puede traer la fila del otro.
//
// En WhatsApp el número además tiene identidad propia —`waba_id`,
// `whatsapp_phone_e164`— porque el `phone_number_id` no dice ni a qué WABA
// pertenece ni qué número es para un humano.
export type PageChannel = "messenger" | "instagram" | "whatsapp"

export type ConnectedPageRecord = {
  id: string
  tenantId: string
  channel: PageChannel
  metaPageId: string
  name: string
  // El @handle. Solo Instagram lo tiene; en Messenger queda null.
  username: string | null
  status: PageStatus
  tokenStatus: PageTokenStatus
  tokenError: string | null
  tokenErrorAt: Date | null
  // Null en Messenger: los page tokens no vencen. En Instagram vence a los ~60
  // días y esta es la fecha que mira el refresh.
  tokenExpiresAt: Date | null
  webhookUrl: string | null
  // Las cinco columnas de WhatsApp (migración 0017). Null en Messenger e
  // Instagram, que no tienen ni WABA ni número ni historial que importar.
  //
  // `wabaId` + `whatsappPhoneE164` son la identidad que `metaPageId` no cuenta:
  // ahí vive el `phone_number_id`, que no dice ni a qué WABA pertenece ni qué
  // número es para un humano. `onboardingMode` decide por qué diálogo se
  // reconecta y si aplican los límites de Coexistence. `historySyncStatus` es
  // el estado accionable del import, con su plazo duro de 24 h.
  wabaId: string | null
  whatsappPhoneE164: string | null
  onboardingMode: WhatsappOnboardingMode | null
  coexistenceStatus: string | null
  historySyncStatus: HistorySyncStatus | null
  // **De quién es el PIN de verificación en dos pasos**, no el PIN. `true` solo
  // cuando lo generamos nosotros al registrar un número que no tenía 2FA: ese
  // —y solo ese— hay que poder devolvérselo al cliente (migración 0017). El
  // valor cifrado nunca sale de este módulo por acá; se pide aparte y en
  // singular con `getWhatsappGeneratedPin`.
  whatsappPinGenerated: boolean
  // Solo si existe, nunca el valor: el secreto cifrado no tiene por qué salir
  // de la base, y menos cruzar el límite serializable hacia el cliente.
  hasSigningSecret: boolean
  connectedAt: Date
  disconnectedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type ConnectedPageRow = {
  id: string
  tenant_id: string
  channel: PageChannel
  meta_page_id: string
  name: string
  username: string | null
  status: PageStatus
  token_status: PageTokenStatus
  token_error: string | null
  token_error_at: Date | null
  token_expires_at: Date | null
  webhook_url: string | null
  // Opcionales en la fila y no en el record: no todas las consultas de este
  // módulo las seleccionan —al resolver un token no hace falta el historial—,
  // y `mapConnectedPage` normaliza la ausencia a null.
  waba_id?: string | null
  whatsapp_phone_e164?: string | null
  onboarding_mode?: WhatsappOnboardingMode | null
  coexistence_status?: string | null
  history_sync_status?: HistorySyncStatus | null
  // Ya viene `coalesce(..., false)` de la consulta: `null` en la columna
  // significa «no consta», y no consta se trata como «no lo enseñes».
  whatsapp_pin_generated?: boolean
  has_signing_secret?: boolean
  connected_at: Date
  disconnected_at: Date | null
  created_at: Date
  updated_at: Date
}

type ConnectedPageWithTokenRow = ConnectedPageRow & {
  page_access_token_encrypted: string
}

export class PageOwnershipError extends Error {
  constructor(public readonly metaPageId: string) {
    super("page already belongs to another tenant")
    this.name = "PageOwnershipError"
  }
}

// Lleva el **código** de `normalizeWebhookUrl`, no un mensaje: quien la atrapa
// es la server action, que sí tiene el idioma del usuario a mano. El `message`
// del Error se queda con el código para que un log no salga vacío.
export class InvalidWebhookUrlError extends Error {
  constructor(readonly code: WebhookUrlError) {
    super(code)
    this.name = "InvalidWebhookUrlError"
  }
}

export async function connectAuthorizedPages(
  tenantId: string,
  pages: MetaConnectedPage[]
) {
  if (pages.length === 0) return []

  const sql = getSql()

  // Fase de lectura (verifica propiedad) + batch atómico de escrituras: el
  // driver HTTP de Neon no soporta transacciones interactivas. Las guardas
  // `tenant_id = ${tenantId}` en el update y el unique `(channel, meta_page_id)`
  // en el insert cubren la carrera entre ambas fases.
  const writes: Promise<unknown>[] = []
  for (const page of pages) {
    const encryptedToken = encryptSecret(page.pageAccessToken)
    // Filtrado por canal: desde la migración 0013 el mismo `meta_page_id` puede
    // existir en Instagram, y sin este predicado una cuenta de IG de otro tenant
    // haría fallar la conexión de una página de Facebook por un choque que no
    // significa nada.
    const [existing] = await sql<Pick<ConnectedPageRow, "id" | "tenant_id">[]>`
      select id, tenant_id
      from connected_pages
      where channel = 'messenger' and meta_page_id = ${page.pageId}
      limit 1
    `

    if (existing && existing.tenant_id !== tenantId) {
      throw new PageOwnershipError(page.pageId)
    }

    writes.push(
      existing
        ? sql`
            update connected_pages
            set name = ${page.name},
                status = 'active',
                token_status = 'valid',
                token_error = null,
                token_error_at = null,
                page_access_token_encrypted = ${encryptedToken},
                connected_at = now(),
                disconnected_at = null,
                updated_at = now()
            where id = ${existing.id} and tenant_id = ${tenantId}
            returning id, tenant_id, channel, meta_page_id, name, username,
              status, token_status, token_error, token_error_at,
              token_expires_at, webhook_url,
              (webhook_signing_secret_encrypted is not null) as has_signing_secret,
              connected_at, disconnected_at,
              created_at, updated_at
          `
        : sql`
            insert into connected_pages (
              tenant_id,
              channel,
              meta_page_id,
              name,
              page_access_token_encrypted
            )
            values (
              ${tenantId}, 'messenger', ${page.pageId}, ${page.name},
              ${encryptedToken}
            )
            returning id, tenant_id, channel, meta_page_id, name, username,
              status, token_status, token_error, token_error_at,
              token_expires_at, webhook_url,
              (webhook_signing_secret_encrypted is not null) as has_signing_secret,
              connected_at, disconnected_at,
              created_at, updated_at
          `
    )
  }

  const results = await sql.transaction(writes)
  return results.flatMap((rows) =>
    (rows as ConnectedPageRow[]).map(mapConnectedPage)
  )
}

// Cupo del plan: cuenta las conexiones `active` (desconectar es un UPDATE, no
// un DELETE, y las desconectadas no ocupan cupo).
//
// **Sin ramas por canal** (ADR 0011). El modelo de negocio es por recurso
// conectado: una cuenta de Instagram ocupa un slot igual que una Página de
// Facebook, y una Página y la cuenta de IG del mismo negocio son dos
// conexiones. El filtro por canal que vivía acá hacía invisible a Instagram en
// los tres lugares donde el cupo se muestra. La consulta va sin ramas acá y no
// en el llamador porque este es el número que alimenta a la vez el entitlement
// (`ADR 0003`) y la pantalla de selección.
//
// El nombre sigue diciendo «pages» y ya no significa Páginas: es deuda
// declarada en la ADR 0011, no descuido.
export async function countActivePages(tenantId: string): Promise<number> {
  const sql = getSql()
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from connected_pages
    where tenant_id = ${tenantId}
      and status = 'active'
  `

  return row?.count ?? 0
}

/**
 * Cuántos números siguen activos en un WABA, **de cualquier tenant**.
 *
 * Existe porque en WhatsApp la unidad que se conecta y la que se suscribe no
 * son la misma: se conecta un número y se suscribe el WABA, y un WABA puede
 * tener varios números. Dar de baja la suscripción con cada desconexión apagaba
 * los webhooks de todos los demás números de esa cuenta sin ningún error
 * visible.
 *
 * El conteo cruza tenants a propósito, por el mismo motivo por el que existe el
 * problema: el WABA es compartido y desuscribirlo los afecta a todos igual.
 *
 * `excludeConnectionIds` son las filas que la operación en curso está dando de
 * baja. Los llamadores marcan primero y preguntan después, así que en la
 * práctica ya se ven `disconnected`; el parámetro cubre al que borra el tenant
 * entero, donde el `delete` y esta consulta no comparten transacción.
 */
export async function countActiveWhatsappNumbersInWaba(input: {
  wabaId: string
  excludeConnectionIds?: string[]
}): Promise<number> {
  const sql = getSql()
  const excluded = input.excludeConnectionIds ?? []
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from connected_pages
    where channel = 'whatsapp'
      and waba_id = ${input.wabaId}
      and status = 'active'
      and not (id = any(${excluded}::uuid[]))
  `

  return row?.count ?? 0
}

// Ownership de una lista de páginas de Meta, de cualquier tenant y en
// cualquier estado: lo consume el módulo puro de selección, que decide página
// por página (ADR 0004). Ya no se lanza sobre la lista completa.
//
// Acotado a Messenger: los ids que llegan son page ids de Facebook, y una
// cuenta de Instagram que casualmente tenga el mismo id se mostraría como
// «ya pertenece a otra cuenta» sin que tenga nada que ver.
export async function getPageOwnership(
  metaPageIds: string[]
): Promise<PageOwnershipRow[]> {
  if (metaPageIds.length === 0) return []

  const sql = getSql()
  const rows = await sql<
    Pick<ConnectedPageRow, "meta_page_id" | "tenant_id" | "status">[]
  >`
    select meta_page_id, tenant_id, status
    from connected_pages
    where channel = 'messenger'
      and meta_page_id = any(${metaPageIds}::text[])
  `

  return rows.map((row) => ({
    metaPageId: row.meta_page_id,
    tenantId: row.tenant_id,
    status: row.status,
  }))
}

export async function listTenantPages(tenantId: string) {
  const sql = getSql()
  const rows = await sql<ConnectedPageRow[]>`
    select id, tenant_id, channel, meta_page_id, name, username, status,
      token_status, token_error, token_error_at, token_expires_at, webhook_url,
      waba_id, whatsapp_phone_e164, onboarding_mode, coexistence_status,
      history_sync_status,
      coalesce(whatsapp_pin_generated, false) as whatsapp_pin_generated,
      (webhook_signing_secret_encrypted is not null) as has_signing_secret,
      connected_at, disconnected_at, created_at, updated_at
    from connected_pages
    where tenant_id = ${tenantId}
    order by case when status = 'active' then 0 else 1 end, updated_at desc
  `

  return rows.map(mapConnectedPage)
}

export async function updatePageWebhookUrl(
  tenantId: string,
  connectionId: string,
  webhookUrlInput: unknown
) {
  const normalized = normalizeWebhookUrl(webhookUrlInput)
  if (!normalized.ok) throw new InvalidWebhookUrlError(normalized.error)

  const sql = getSql()
  const [row] = await sql<ConnectedPageRow[]>`
    update connected_pages
    set webhook_url = ${normalized.value}, updated_at = now()
    where id = ${connectionId} and tenant_id = ${tenantId} and status = 'active'
    returning id, tenant_id, channel, meta_page_id, name, username, status,
      token_status, token_error, token_error_at, token_expires_at, webhook_url,
      (webhook_signing_secret_encrypted is not null) as has_signing_secret,
      connected_at, disconnected_at, created_at, updated_at
  `

  return row ? mapConnectedPage(row) : null
}

// Rota el secreto de firma y devuelve el valor en claro **una sola vez**: en la
// base solo queda cifrado, así que si el usuario no lo copia acá no hay forma de
// recuperarlo, solo de rotarlo otra vez. Mismo criterio que las API keys.
export async function rotateWebhookSigningSecret(
  tenantId: string,
  connectionId: string
): Promise<string | null> {
  const secret = generateWebhookSigningSecret()
  const sql = getSql()
  const rows = await sql`
    update connected_pages
    set webhook_signing_secret_encrypted = ${encryptWebhookSigningSecret(secret)},
      webhook_signing_secret_rotated_at = now(),
      updated_at = now()
    where id = ${connectionId} and tenant_id = ${tenantId} and status = 'active'
    returning id
  `
  return rows[0] ? secret : null
}

// Solo si falta. Se llama al guardar la `webhookUrl` para que una conexión nueva
// quede firmada desde el primer evento sin que el usuario tenga que saber que la
// firma existe. Rotar cuando ya hay uno invalidaría el que el receptor tiene
// configurado, que es justo lo que no debe pasar al tocar la URL.
export async function ensureWebhookSigningSecret(
  tenantId: string,
  connectionId: string
): Promise<string | null> {
  const secret = generateWebhookSigningSecret()
  const sql = getSql()
  const rows = await sql`
    update connected_pages
    set webhook_signing_secret_encrypted = ${encryptWebhookSigningSecret(secret)},
      webhook_signing_secret_rotated_at = now(),
      updated_at = now()
    where id = ${connectionId} and tenant_id = ${tenantId} and status = 'active'
      and webhook_signing_secret_encrypted is null
    returning id
  `
  return rows[0] ? secret : null
}

export async function disconnectPage(tenantId: string, connectionId: string) {
  const sql = getSql()
  const [row] = await sql<ConnectedPageRow[]>`
    update connected_pages
    set status = 'disconnected',
        disconnected_at = coalesce(disconnected_at, now()),
        updated_at = now()
    where id = ${connectionId} and tenant_id = ${tenantId}
    returning id, tenant_id, channel, meta_page_id, name, username, status,
      token_status, token_error, token_error_at, token_expires_at, webhook_url,
      (webhook_signing_secret_encrypted is not null) as has_signing_secret,
      connected_at, disconnected_at, created_at, updated_at
  `

  return row ? mapConnectedPage(row) : null
}

// El canal es explícito y sin default en los tres resolvers que buscan por
// `meta_page_id`: es la clave que la migración 0013 volvió ambigua, y un default
// convertiría «me olvidé de decidir» en «Messenger» sin que nadie lo note.
export async function getActivePageTokenForTenant(
  tenantId: string,
  metaPageId: string,
  channel: PageChannel
) {
  const sql = getSql()
  const [row] = await sql<{ page_access_token_encrypted: string }[]>`
    select page_access_token_encrypted
    from connected_pages
    where tenant_id = ${tenantId}
      and channel = ${channel}
      and meta_page_id = ${metaPageId}
      and status = 'active'
    limit 1
  `

  if (!row) return null
  return decryptSecret(row.page_access_token_encrypted)
}

export async function getActivePageWithTokenForTenant(
  tenantId: string,
  metaPageId: string,
  channel: PageChannel
) {
  const sql = getSql()
  const [row] = await sql<ConnectedPageWithTokenRow[]>`
    select id, tenant_id, channel, meta_page_id, name, username, status,
      token_status, token_error, token_error_at, token_expires_at, webhook_url,
      (webhook_signing_secret_encrypted is not null) as has_signing_secret,
      connected_at, disconnected_at, created_at, updated_at,
      page_access_token_encrypted
    from connected_pages
    where tenant_id = ${tenantId}
      and channel = ${channel}
      and meta_page_id = ${metaPageId}
      and status = 'active'
    limit 1
  `

  if (!row) return null

  return {
    page: mapConnectedPage(row),
    pageAccessToken: decryptSecret(row.page_access_token_encrypted),
  }
}

export async function getActivePageWithTokenByConnectionId(
  tenantId: string,
  connectionId: string
) {
  const sql = getSql()
  const [row] = await sql<ConnectedPageWithTokenRow[]>`
    select id, tenant_id, channel, meta_page_id, name, username, status,
      token_status, token_error, token_error_at, token_expires_at, webhook_url,
      (webhook_signing_secret_encrypted is not null) as has_signing_secret,
      connected_at, disconnected_at, created_at, updated_at,
      page_access_token_encrypted
    from connected_pages
    where id = ${connectionId}
      and tenant_id = ${tenantId}
      and status = 'active'
    limit 1
  `

  if (!row) return null

  return {
    page: mapConnectedPage(row),
    pageAccessToken: decryptSecret(row.page_access_token_encrypted),
  }
}

export async function getActivePageByMetaPageId(
  metaPageId: string,
  channel: PageChannel
) {
  const sql = getSql()
  const [row] = await sql<ConnectedPageRow[]>`
    select id, tenant_id, channel, meta_page_id, name, username, status,
      token_status, token_error, token_error_at, token_expires_at, webhook_url,
      waba_id, whatsapp_phone_e164, onboarding_mode,
      coexistence_status, history_sync_status,
      (webhook_signing_secret_encrypted is not null) as has_signing_secret,
      connected_at, disconnected_at, created_at, updated_at
    from connected_pages
    where channel = ${channel}
      and meta_page_id = ${metaPageId}
      and status = 'active'
    limit 1
  `

  return row ? mapConnectedPage(row) : null
}

export type InstagramAccountInput = {
  igUserId: string
  username: string
  name: string | null
  accessToken: string
  tokenExpiresAt: Date | null
}

// Conecta (o reconecta) la única cuenta que autorizó el OAuth de Instagram.
//
// No hay pantalla de selección como en Facebook: Instagram Login devuelve
// exactamente una cuenta, así que no existe el problema que motivó la ADR 0004
// —persistir tokens de páginas que el usuario no eligió— y el callback puede
// escribir directo.
//
// Read-then-write en vez de `on conflict`, igual que `connectAuthorizedPages`:
// necesitamos distinguir «es de otro tenant» (error de propiedad, con su
// mensaje) de «es una reconexión», y un upsert ciego pisaría la fila ajena.
export async function connectInstagramAccount(
  tenantId: string,
  account: InstagramAccountInput
): Promise<ConnectedPageRecord> {
  const sql = getSql()
  const encryptedToken = encryptSecret(account.accessToken)

  const [existing] = await sql<Pick<ConnectedPageRow, "id" | "tenant_id">[]>`
    select id, tenant_id
    from connected_pages
    where channel = 'instagram' and meta_page_id = ${account.igUserId}
    limit 1
  `

  if (existing && existing.tenant_id !== tenantId) {
    throw new PageOwnershipError(account.igUserId)
  }

  // El nombre visible puede venir vacío (Meta no siempre lo devuelve); el
  // @handle siempre está, y es además lo que el usuario reconoce.
  const displayName = account.name ?? `@${account.username}`

  const [row] = existing
    ? await sql<ConnectedPageRow[]>`
        update connected_pages
        set name = ${displayName},
            username = ${account.username},
            status = 'active',
            token_status = 'valid',
            token_error = null,
            token_error_at = null,
            page_access_token_encrypted = ${encryptedToken},
            token_expires_at = ${account.tokenExpiresAt},
            connected_at = now(),
            disconnected_at = null,
            updated_at = now()
        where id = ${existing.id} and tenant_id = ${tenantId}
        returning id, tenant_id, channel, meta_page_id, name, username, status,
          token_status, token_error, token_error_at, token_expires_at,
          webhook_url, connected_at, disconnected_at, created_at, updated_at
      `
    : await sql<ConnectedPageRow[]>`
        insert into connected_pages (
          tenant_id,
          channel,
          meta_page_id,
          name,
          username,
          page_access_token_encrypted,
          token_expires_at
        )
        values (
          ${tenantId}, 'instagram', ${account.igUserId}, ${displayName},
          ${account.username}, ${encryptedToken}, ${account.tokenExpiresAt}
        )
        returning id, tenant_id, channel, meta_page_id, name, username, status,
          token_status, token_error, token_error_at, token_expires_at,
          webhook_url, connected_at, disconnected_at, created_at, updated_at
      `

  // El update filtra por `tenant_id`: si otro tenant se quedó con la fila entre
  // la lectura y la escritura no devuelve nada, y eso es el mismo conflicto de
  // propiedad que arriba, no un fallo genérico.
  if (!row) throw new PageOwnershipError(account.igUserId)

  return mapConnectedPage(row)
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/**
 * De quién es el PIN de verificación en dos pasos que se acaba de usar. Son
 * tres casos y no un booleano porque el del medio existe: al reconectar, el PIN
 * que mandamos es el que ya teníamos guardado, y eso **no** cambia de quién es.
 *
 * - `generated`: lo creamos nosotros ahora, activándole la 2FA a un número que
 *   no la tenía. Es el único que hay que poder enseñarle al cliente.
 * - `stored`: el que ya estaba guardado de un registro anterior. Sigue siendo
 *   nuestro, así que la marca no se toca.
 * - `customer`: lo aportó el cliente tras un 133005. Desde ese momento el PIN es
 *   suyo y no se enseña más: mostrárselo sería devolverle un secreto que él nos
 *   dio, y en la pantalla equivocada.
 */
export type WhatsappPinOrigin = "generated" | "stored" | "customer"

export type WhatsappNumberOwnership = {
  /** La fila existe y es de otro tenant: el número no se puede tomar. */
  ownedByOtherTenant: boolean
  /**
   * Ya está `active` para **este** tenant: es una reconexión y no consume un
   * hueco nuevo del plan.
   */
  activeForTenant: boolean
  connectionId: string | null
  /**
   * El PIN que ya teníamos guardado, descifrado. Es lo que hace posible
   * reconectar: `/register` vuelve a pedir el PIN vigente —el nuestro— y sin
   * esto la segunda conexión fallaría siempre con 133005 pidiéndole al cliente
   * un PIN que inventamos nosotros.
   *
   * `null` cuando la fila es de otro tenant: el PIN es del número, pero no se
   * le entrega a quien no es su dueño en Resender, ni siquiera para usarlo.
   */
  storedPin: string | null
  /** Si el PIN guardado lo generamos nosotros (`coalesce(..., false)`). */
  storedPinGenerated: boolean
}

/**
 * El veredicto que hace falta **entre las dos mitades** del onboarding
 * (`beginWhatsappSignup` / `finishWhatsappSignup`): de quién es este
 * `phone_number_id` y con qué PIN hay que registrarlo.
 *
 * Es una sola consulta y no dos porque las tres respuestas salen de la misma
 * fila, y porque preguntarlo dos veces abriría una ventana en la que el número
 * cambia de dueño entre pregunta y pregunta.
 */
export async function resolveWhatsappNumberOwnership(
  tenantId: string,
  phoneNumberId: string
): Promise<WhatsappNumberOwnership> {
  const sql = getSql()
  const [row] = await sql<
    {
      id: string
      tenant_id: string
      status: PageStatus
      whatsapp_pin_encrypted: string | null
      whatsapp_pin_generated: boolean
    }[]
  >`
    select id, tenant_id, status, whatsapp_pin_encrypted,
      coalesce(whatsapp_pin_generated, false) as whatsapp_pin_generated
    from connected_pages
    where channel = 'whatsapp' and meta_page_id = ${phoneNumberId}
    limit 1
  `

  if (!row) {
    return {
      ownedByOtherTenant: false,
      activeForTenant: false,
      connectionId: null,
      storedPin: null,
      storedPinGenerated: false,
    }
  }

  if (row.tenant_id !== tenantId) {
    return {
      ownedByOtherTenant: true,
      activeForTenant: false,
      connectionId: null,
      storedPin: null,
      storedPinGenerated: false,
    }
  }

  return {
    ownedByOtherTenant: false,
    activeForTenant: row.status === "active",
    connectionId: row.id,
    storedPin: row.whatsapp_pin_encrypted
      ? decryptSecret(row.whatsapp_pin_encrypted)
      : null,
    storedPinGenerated: row.whatsapp_pin_generated === true,
  }
}

export type WhatsappNumberInput = {
  /** El `phone_number_id`, que en este canal es el `meta_page_id`. */
  phoneNumberId: string
  wabaId: string
  wabaName: string | null
  phoneE164: string | null
  verifiedName: string | null
  accessToken: string
  tokenExpiresAt: Date | null
  /**
   * El PIN en claro, o `null` en Coexistence —que no llama a `/register` y por
   * tanto no tiene PIN que guardar—. Se cifra acá adentro con la misma clave
   * que el token: el llamador no debe tener que acordarse.
   */
  pin: string | null
  pinOrigin: WhatsappPinOrigin
  onboardingMode: WhatsappOnboardingMode
  /**
   * Estado inicial del import de historial. `not_requested` en Coexistence —la
   * solicitud sale en un job **después** de persistir, para no arrancar el reloj
   * de 24 h sobre una fila que todavía no existe— y `null` en el estándar, que
   * no tiene historial que traer.
   */
  historySyncStatus: HistorySyncStatus | null
}

/**
 * Conecta (o reconecta) el número que autorizó el Embedded Signup.
 *
 * Read-then-write como `connectInstagramAccount` y por el mismo motivo:
 * necesitamos distinguir «es de otro tenant» —error de propiedad, con su
 * mensaje— de «es una reconexión», y un upsert ciego pisaría la fila ajena. El
 * unique `(channel, meta_page_id)` de la 0013 cierra la carrera entre las dos
 * fases, y el `tenant_id` en el `where` del update la cierra del otro lado.
 *
 * **El PIN se escribe solo cuando hay uno.** En una reconexión de Coexistence
 * `pin` es `null` y la columna se deja como está: pisarla con null borraría el
 * PIN de un registro estándar anterior y dejaría el número sin poder
 * re-registrarse nunca más.
 */
export async function connectWhatsappNumber(
  tenantId: string,
  input: WhatsappNumberInput
): Promise<ConnectedPageRecord> {
  const sql = getSql()
  const encryptedToken = encryptSecret(input.accessToken)
  // `null` cuando no hay PIN nuevo: el `coalesce` del UPDATE conserva el que
  // hubiera. Cifrado acá y nunca antes: en memoria del llamador vive lo mínimo.
  const encryptedPin = input.pin ? encryptSecret(input.pin) : null
  // Solo el que generamos nosotros se enseña. `stored` no toca la marca —el PIN
  // sigue siendo el mismo de antes— y por eso viaja como `null` y lo resuelve
  // el `coalesce`.
  const pinGenerated =
    input.pinOrigin === "generated"
      ? true
      : input.pinOrigin === "customer"
        ? false
        : null

  // El nombre visible: el número es lo que el usuario reconoce, pero el nombre
  // verificado del negocio es lo que ve su cliente en el chat. Se prefiere el
  // número porque es lo que identifica la conexión sin ambigüedad cuando el
  // mismo negocio tiene dos.
  const displayName =
    input.phoneE164 ??
    input.verifiedName ??
    input.wabaName ??
    input.phoneNumberId

  const [existing] = await sql<Pick<ConnectedPageRow, "id" | "tenant_id">[]>`
    select id, tenant_id
    from connected_pages
    where channel = 'whatsapp' and meta_page_id = ${input.phoneNumberId}
    limit 1
  `

  if (existing && existing.tenant_id !== tenantId) {
    throw new PageOwnershipError(input.phoneNumberId)
  }

  const [row] = existing
    ? await sql<ConnectedPageRow[]>`
        update connected_pages
        set name = ${displayName},
            status = 'active',
            token_status = 'valid',
            token_error = null,
            token_error_at = null,
            page_access_token_encrypted = ${encryptedToken},
            token_expires_at = ${input.tokenExpiresAt},
            waba_id = ${input.wabaId},
            whatsapp_phone_e164 = ${input.phoneE164},
            onboarding_mode = ${input.onboardingMode},
            history_sync_status = ${input.historySyncStatus},
            whatsapp_pin_encrypted = coalesce(${encryptedPin}, whatsapp_pin_encrypted),
            whatsapp_pin_generated = coalesce(${pinGenerated}, whatsapp_pin_generated),
            connected_at = now(),
            disconnected_at = null,
            updated_at = now()
        where id = ${existing.id} and tenant_id = ${tenantId}
        returning id, tenant_id, channel, meta_page_id, name, username, status,
          token_status, token_error, token_error_at, token_expires_at,
          webhook_url, waba_id, whatsapp_phone_e164, onboarding_mode,
          coexistence_status, history_sync_status,
          coalesce(whatsapp_pin_generated, false) as whatsapp_pin_generated,
          (webhook_signing_secret_encrypted is not null) as has_signing_secret,
          connected_at, disconnected_at, created_at, updated_at
      `
    : await sql<ConnectedPageRow[]>`
        insert into connected_pages (
          tenant_id,
          channel,
          meta_page_id,
          name,
          page_access_token_encrypted,
          token_expires_at,
          waba_id,
          whatsapp_phone_e164,
          onboarding_mode,
          history_sync_status,
          whatsapp_pin_encrypted,
          whatsapp_pin_generated
        )
        values (
          ${tenantId}, 'whatsapp', ${input.phoneNumberId}, ${displayName},
          ${encryptedToken}, ${input.tokenExpiresAt}, ${input.wabaId},
          ${input.phoneE164}, ${input.onboardingMode},
          ${input.historySyncStatus}, ${encryptedPin},
          ${pinGenerated ?? false}
        )
        returning id, tenant_id, channel, meta_page_id, name, username, status,
          token_status, token_error, token_error_at, token_expires_at,
          webhook_url, waba_id, whatsapp_phone_e164, onboarding_mode,
          coexistence_status, history_sync_status,
          coalesce(whatsapp_pin_generated, false) as whatsapp_pin_generated,
          (webhook_signing_secret_encrypted is not null) as has_signing_secret,
          connected_at, disconnected_at, created_at, updated_at
      `

  // El update filtra por `tenant_id`: si otro tenant se quedó con la fila entre
  // la lectura y la escritura no devuelve nada, y eso es el mismo conflicto de
  // propiedad que arriba, no un fallo genérico.
  if (!row) throw new PageOwnershipError(input.phoneNumberId)

  return mapConnectedPage(row)
}

/**
 * El PIN que **generamos nosotros**, en claro, para enseñárselo a su dueño.
 *
 * Devuelve `null` en los tres casos que no son ese: la conexión no es de este
 * tenant, no hay PIN guardado, o el PIN lo aportó el cliente
 * (`whatsapp_pin_generated = false`). El `coalesce` es lo que hace que «no
 * consta» caiga del lado de no enseñarlo.
 *
 * Es la única salida del PIN de este módulo y es deliberadamente estrecha: pide
 * el tenant, pide la conexión concreta y no acepta un `meta_page_id`, que es lo
 * que una consulta de soporte tendría a mano.
 */
export async function getWhatsappGeneratedPin(
  tenantId: string,
  connectionId: string
): Promise<string | null> {
  const sql = getSql()
  const [row] = await sql<{ whatsapp_pin_encrypted: string | null }[]>`
    select whatsapp_pin_encrypted
    from connected_pages
    where id = ${connectionId}
      and tenant_id = ${tenantId}
      and channel = 'whatsapp'
      and coalesce(whatsapp_pin_generated, false) = true
    limit 1
  `

  if (!row?.whatsapp_pin_encrypted) return null
  return decryptSecret(row.whatsapp_pin_encrypted)
}

/**
 * Mueve el estado del import de historial de Coexistence.
 *
 * Lo escribe el cierre del onboarding cuando **no consigue encolar** el job
 * —ahí el estado correcto es `failed` y no `not_requested`, porque nadie va a
 * pedir ese historial nunca— y lo escribe después el consumidor de la cola a
 * medida que Meta responde. Sin canal en el `where`: la columna solo existe
 * para WhatsApp, pero el filtro está igual para que un id de otra conexión no
 * pueda tocar una fila que no le corresponde.
 */
export async function updateWhatsappHistorySyncStatus(input: {
  connectionId: string
  status: HistorySyncStatus
  tenantId?: string
}): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    update connected_pages
    set history_sync_status = ${input.status}, updated_at = now()
    where id = ${input.connectionId}
      and channel = 'whatsapp'
      and (${input.tenantId ?? null}::uuid is null
           or tenant_id = ${input.tenantId ?? null}::uuid)
    returning id
  `

  return rows.length > 0
}

export async function markPageTokenInvalid(input: {
  tenantId: string
  connectionId: string
  error: string
}) {
  const sql = getSql()
  const [row] = await sql<ConnectedPageRow[]>`
    update connected_pages
    set token_status = 'invalid',
        token_error = ${input.error},
        token_error_at = now(),
        updated_at = now()
    where id = ${input.connectionId}
      and tenant_id = ${input.tenantId}
      and status = 'active'
    returning id, tenant_id, channel, meta_page_id, name, username, status,
      token_status, token_error, token_error_at, token_expires_at, webhook_url,
      (webhook_signing_secret_encrypted is not null) as has_signing_secret,
      connected_at, disconnected_at, created_at, updated_at
  `

  return row ? mapConnectedPage(row) : null
}

function mapConnectedPage(row: ConnectedPageRow): ConnectedPageRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    channel: row.channel,
    metaPageId: row.meta_page_id,
    name: row.name,
    username: row.username,
    status: row.status,
    tokenStatus: row.token_status,
    tokenError: row.token_error,
    tokenErrorAt: row.token_error_at,
    tokenExpiresAt: row.token_expires_at,
    webhookUrl: row.webhook_url,
    wabaId: row.waba_id ?? null,
    whatsappPhoneE164: row.whatsapp_phone_e164 ?? null,
    onboardingMode: row.onboarding_mode ?? null,
    coexistenceStatus: row.coexistence_status ?? null,
    historySyncStatus: row.history_sync_status ?? null,
    // Fail closed, igual que el `coalesce` de la consulta: enseñar de más un
    // PIN ajeno es peor que callar uno propio, que además se recupera
    // reconectando.
    whatsappPinGenerated: row.whatsapp_pin_generated === true,
    hasSigningSecret: row.has_signing_secret === true,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
