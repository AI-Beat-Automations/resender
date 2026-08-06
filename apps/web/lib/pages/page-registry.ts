import type { ConnectedPage as MetaConnectedPage } from "@/lib/meta"
import { decryptSecret, encryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"

import type { PageOwnershipRow } from "./page-selection"
import { normalizeWebhookUrl } from "./webhook-url"

export type PageStatus = "active" | "disconnected"
export type PageTokenStatus = "valid" | "invalid"

// `connected_pages` dejó de ser "páginas de Facebook" (migración 0013): ahora es
// cuentas conectadas, y `channel` es el discriminador. `meta_page_id` guarda el
// page id en Messenger y el IG ID de la cuenta profesional en Instagram; el
// unique es `(channel, meta_page_id)`, así que **toda** búsqueda por
// `meta_page_id` tiene que decir de qué canal habla o puede traer la fila del
// otro.
export type PageChannel = "messenger" | "instagram"

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

export class InvalidWebhookUrlError extends Error {
  constructor(message: string) {
    super(message)
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
              token_expires_at, webhook_url, connected_at, disconnected_at,
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
              token_expires_at, webhook_url, connected_at, disconnected_at,
              created_at, updated_at
          `
    )
  }

  const results = await sql.transaction(writes)
  return results.flatMap((rows) =>
    (rows as ConnectedPageRow[]).map(mapConnectedPage)
  )
}

// Cupo del plan: cuenta solo las páginas `active` (desconectar es un UPDATE,
// no un DELETE, y las desconectadas no ocupan cupo).
//
// **Solo Messenger.** Instagram queda fuera del cupo de páginas por ahora, así
// que conectar una cuenta de IG no puede consumir un slot del plan ni empujar a
// un tenant a `page_limit_exceeded`. El filtro va acá y no en el llamador
// porque este es el número que alimenta a la vez el entitlement (`ADR 0003`) y
// la pantalla de selección.
export async function countActivePages(tenantId: string): Promise<number> {
  const sql = getSql()
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from connected_pages
    where tenant_id = ${tenantId}
      and channel = 'messenger'
      and status = 'active'
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
      connected_at, disconnected_at, created_at, updated_at
  `

  return row ? mapConnectedPage(row) : null
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
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
