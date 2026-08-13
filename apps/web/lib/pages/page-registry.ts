import type { ConnectedPage as MetaConnectedPage } from "@/lib/meta"
import { decryptSecret, encryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"

import type { PageOwnershipRow } from "./page-selection"
import { normalizeWebhookUrl } from "./webhook-url"

export type PageStatus = "active" | "disconnected"
export type PageTokenStatus = "valid" | "invalid"

// `connected_pages` dejó de ser "páginas de Facebook" (migración 0013): ahora es
// cuentas conectadas, y `channel` es el discriminador. `meta_page_id` guarda el
// page id en Messenger, el IG ID de la cuenta profesional en Instagram y el
// `phone_number_id` en WhatsApp (migración 0015); el unique es
// `(channel, meta_page_id)`, así que **toda** búsqueda por `meta_page_id` tiene
// que decir de qué canal habla o puede traer la fila de otro.
//
// Esta unión es la raíz de todo el cableado por canal de la app: al agregar un
// miembro rompen a propósito los `Record<PageChannel, X>` que hay repartidos
// —cuota, badges, despacho de webhook—, que es exactamente el punto. Cada uno
// de esos mapas es una decisión que alguien tiene que tomar, y un ternario
// binario la tomaría sola y en silencio por la rama de Messenger.
export type PageChannel = "messenger" | "instagram" | "whatsapp"

export type ConnectedPageRecord = {
  id: string
  tenantId: string
  channel: PageChannel
  metaPageId: string
  name: string
  // El @handle. Solo Instagram lo tiene; en Messenger y WhatsApp queda null.
  username: string | null
  status: PageStatus
  tokenStatus: PageTokenStatus
  tokenError: string | null
  tokenErrorAt: Date | null
  // Null en Messenger: los page tokens no vencen. En Instagram vence a los ~60
  // días y esta es la fecha que mira el refresh.
  tokenExpiresAt: Date | null
  // Identidad de WhatsApp (migración 0015), null en los otros dos canales. El
  // `phone_number_id` vive en `meta_page_id` porque es la clave del unique por
  // canal, pero no es lo que el usuario reconoce ni lo que Meta pide para
  // suscribir: para lo primero está el número en E.164 y para lo segundo el
  // WABA. Se proyectan acá y no en una consulta aparte porque los dos
  // consumidores —la tarjeta de Conexiones y la desuscripción del webhook— ya
  // tienen la fila entera en la mano.
  wabaId: string | null
  phoneE164: string | null
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
  waba_id: string | null
  whatsapp_phone_e164: string | null
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
    // existir en Instagram —y desde la 0015, en WhatsApp—, y sin este predicado
    // una cuenta de otro canal y otro tenant haría fallar la conexión de una
    // página de Facebook por un choque que no significa nada.
    //
    // El literal `'messenger'` se queda: esta función solo la llama el callback
    // del OAuth de Facebook con page ids de Facebook. No es «falta ampliarlo al
    // tercer canal», es que WhatsApp entra por su propio onboarding y con su
    // propio escritor.
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
              token_expires_at, waba_id, whatsapp_phone_e164, webhook_url,
              connected_at, disconnected_at, created_at, updated_at
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
              token_expires_at, waba_id, whatsapp_phone_e164, webhook_url,
              connected_at, disconnected_at, created_at, updated_at
          `
    )
  }

  const results = await sql.transaction(writes)
  return results.flatMap((rows) =>
    (rows as ConnectedPageRow[]).map(mapConnectedPage)
  )
}

// Cupo del plan: cuenta solo las cuentas `active` (desconectar es un UPDATE, no
// un DELETE, y las desconectadas no ocupan cupo).
//
// **Messenger y WhatsApp; Instagram no.** El criterio es el mismo que decide la
// cuota de mensajes en `lib/inbound/inbound-ingestion.ts`: los dos canales de
// mensajería de pleno derecho ocupan un slot del plan y pueden empujar al
// tenant a `page_limit_exceeded`; Instagram queda fuera porque su valor hoy son
// las respuestas a comentarios y cobrarle un slot desalentaría conectarlo.
// Cupo y cuota se mueven juntos a propósito: si un canal consume mensajes del
// período pero no ocupa cupo (o al revés) el plan deja de tener una sola
// lectura, y nadie sabría explicar qué compró el cliente.
//
// El filtro va acá y no en el llamador porque este es el número que alimenta a
// la vez el entitlement (`ADR 0003`) y la pantalla de selección.
export async function countActivePages(tenantId: string): Promise<number> {
  const sql = getSql()
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from connected_pages
    where tenant_id = ${tenantId}
      and channel in ('messenger', 'whatsapp')
      and status = 'active'
  `

  return row?.count ?? 0
}

// Ownership de una lista de páginas de Meta, de cualquier tenant y en
// cualquier estado: lo consume el módulo puro de selección, que decide página
// por página (ADR 0004). Ya no se lanza sobre la lista completa.
//
// Acotado a Messenger: los ids que llegan son page ids de Facebook, y una
// cuenta de Instagram o un `phone_number_id` de WhatsApp que casualmente tengan
// el mismo id se mostrarían como «ya pertenece a otra cuenta» sin que tenga
// nada que ver.
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

// Las cuentas del tenant para la pantalla de Conexiones.
//
// Proyecta un booleano de más, `has_generated_whatsapp_pin`, y **no el PIN**:
// la tarjeta necesita saber si hay un PIN que enseñar para dibujar el botón,
// pero el PIN en sí solo se descifra cuando alguien lo pide (ver
// `getGeneratedWhatsappPin`). Mandarlo en el HTML de todas las tarjetas lo
// dejaría en el payload RSC de cada visita a la pantalla, que es justo lo que un
// secreto del cliente no puede hacer.
//
// Se calcula en SQL y no en JS por lo mismo: así el cifrado no sale de la base.
export async function listTenantPages(tenantId: string) {
  const sql = getSql()
  const rows = await sql<
    (ConnectedPageRow & { has_generated_whatsapp_pin: boolean })[]
  >`
    select id, tenant_id, channel, meta_page_id, name, username, status,
      token_status, token_error, token_error_at, token_expires_at, waba_id,
      whatsapp_phone_e164, webhook_url, connected_at, disconnected_at,
      created_at, updated_at,
      (
        whatsapp_pin_encrypted is not null
        and coalesce(whatsapp_pin_generated, false)
      ) as has_generated_whatsapp_pin
    from connected_pages
    where tenant_id = ${tenantId}
    order by case when status = 'active' then 0 else 1 end, updated_at desc
  `

  return rows.map((row) => ({
    ...mapConnectedPage(row),
    hasGeneratedWhatsappPin: row.has_generated_whatsapp_pin === true,
  }))
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
      token_status, token_error, token_error_at, token_expires_at, waba_id,
      whatsapp_phone_e164, webhook_url, connected_at, disconnected_at,
      created_at, updated_at
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
      token_status, token_error, token_error_at, token_expires_at, waba_id,
      whatsapp_phone_e164, webhook_url, connected_at, disconnected_at,
      created_at, updated_at
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
      token_status, token_error, token_error_at, token_expires_at, waba_id,
      whatsapp_phone_e164, webhook_url, connected_at, disconnected_at,
      created_at, updated_at,
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
      token_status, token_error, token_error_at, token_expires_at, waba_id,
      whatsapp_phone_e164, webhook_url, connected_at, disconnected_at,
      created_at, updated_at,
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
      token_status, token_error, token_error_at, token_expires_at, waba_id,
      whatsapp_phone_e164, webhook_url, connected_at, disconnected_at,
      created_at, updated_at
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
          waba_id, whatsapp_phone_e164, webhook_url, connected_at,
          disconnected_at, created_at, updated_at
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
          waba_id, whatsapp_phone_e164, webhook_url, connected_at,
          disconnected_at, created_at, updated_at
      `

  // El update filtra por `tenant_id`: si otro tenant se quedó con la fila entre
  // la lectura y la escritura no devuelve nada, y eso es el mismo conflicto de
  // propiedad que arriba, no un fallo genérico.
  if (!row) throw new PageOwnershipError(account.igUserId)

  return mapConnectedPage(row)
}

// Qué flujo de Embedded Signup trajo el número. Se declara acá y no se importa
// de `lib/whatsapp` para no cruzar un import de dominio hacia el cliente de
// Meta: el registro de cuentas conectadas es el que manda sobre lo que la
// columna `onboarding_mode` (0015) admite, y el check de la base dice lo mismo.
export type PageOnboardingMode = "standard" | "coexistence"

// De dónde salió el PIN que se está guardando. Es el dato que falta para poder
// devolverle al cliente un PIN que le creamos nosotros sin enseñarle el suyo
// propio, y no se puede deducir de ninguna columna existente: el `_encrypted`
// tiene la misma pinta en los dos casos.
//
// - `generated`: no tenía verificación en dos pasos y se la activamos con un PIN
//   nuestro. Es el único caso que hay que enseñarle: si borra la cuenta o nos
//   deja, se queda con la 2FA puesta y un PIN que nadie conoce.
// - `customer`: el número ya tenía 2FA y el PIN lo escribió él tras el 133005.
//   Es suyo y ya lo conoce; devolvérselo sería ruido.
// - `stored`: es una reconexión y el PIN es el que ya teníamos guardado. **No se
//   toca el origen**: quien lo generó lo generó, y pisar la marca con `false`
//   solo porque este intento no lo generó escondería el PIN a partir de la
//   segunda conexión, que es exactamente cuando el cliente lo necesita.
export type WhatsappPinOrigin = "generated" | "customer" | "stored"

export type WhatsappNumberInput = {
  // El `phone_number_id`. Es lo que va a `meta_page_id`: la convención del canal
  // desde la 0015, y la que ya usa el webhook entrante de `apps/api` para
  // resolver a qué cuenta pertenece un mensaje.
  phoneNumberId: string
  // El WABA del que cuelga el número. No es decorativo: la suscripción y la
  // desuscripción del webhook cuelgan del WABA, no del número, así que sin esta
  // columna una cuenta conectada no se puede dar de baja en Meta.
  wabaId: string
  wabaName: string | null
  phoneE164: string | null
  verifiedName: string | null
  accessToken: string
  // `null` = no vence. El business token de Embedded Signup puede no caducar;
  // la fecha real la resuelve `debug_token` en el cliente, acá solo se guarda.
  tokenExpiresAt: Date | null
  // El PIN de verificación en dos pasos con el que se registró el número. Se
  // guarda cifrado (migración 0016) porque en el caso normal lo generamos
  // nosotros y Meta no lo devuelve nunca más.
  pin: string
  pinOrigin: WhatsappPinOrigin
  onboardingMode: PageOnboardingMode
}

// Conecta (o reconecta) el número que acaba de completar el Embedded Signup.
// Hermano de `connectInstagramAccount`, y por los mismos motivos: no hay
// pantalla de selección —el flujo autoriza exactamente un número— y el
// read-then-write en vez de un `on conflict` es lo único que permite distinguir
// «es de otro tenant» (error de propiedad, con su mensaje) de «es una
// reconexión». Un upsert ciego pisaría la fila ajena.
//
// **Idempotente para el mismo tenant**: reconectar es un UPDATE de la misma
// fila —token nuevo, nombre nuevo, `status` de vuelta a `active` y el error de
// token limpio—, así que el historial de conversaciones y mensajes, que cuelga
// de `connected_pages.id`, sobrevive intacto.
export async function connectWhatsappNumber(
  tenantId: string,
  number: WhatsappNumberInput
): Promise<ConnectedPageRecord> {
  const sql = getSql()
  // Los dos cifrados van juntos y antes de la primera consulta: si falta la
  // clave, `encryptSecret` lanza acá y no a mitad del upsert, con el número ya
  // registrado en Meta y la fila a medio escribir.
  const encryptedToken = encryptSecret(number.accessToken)
  const encryptedPin = encryptSecret(number.pin)

  // Filtrado por canal, como en los otros dos escritores: el unique es
  // `(channel, meta_page_id)` desde la 0013 y un `phone_number_id` puede
  // coincidir con un page id de Facebook sin que eso signifique nada.
  const [existing] = await sql<Pick<ConnectedPageRow, "id" | "tenant_id">[]>`
    select id, tenant_id
    from connected_pages
    where channel = 'whatsapp' and meta_page_id = ${number.phoneNumberId}
    limit 1
  `

  if (existing && existing.tenant_id !== tenantId) {
    throw new PageOwnershipError(number.phoneNumberId)
  }

  const displayName = resolveWhatsappDisplayName(number)
  // `null` = «no toques la marca», que es lo que toca en una reconexión con el
  // PIN guardado. En el insert no hay marca previa que conservar, así que ahí
  // `stored` no puede llegar y se guarda directamente el booleano.
  const pinGenerated =
    number.pinOrigin === "stored" ? null : number.pinOrigin === "generated"

  const [row] = existing
    ? await sql<ConnectedPageRow[]>`
        update connected_pages
        set name = ${displayName},
            status = 'active',
            token_status = 'valid',
            token_error = null,
            token_error_at = null,
            page_access_token_encrypted = ${encryptedToken},
            token_expires_at = ${number.tokenExpiresAt},
            waba_id = ${number.wabaId},
            whatsapp_phone_e164 = ${number.phoneE164},
            whatsapp_pin_encrypted = ${encryptedPin},
            whatsapp_pin_generated = coalesce(
              ${pinGenerated}::boolean, whatsapp_pin_generated
            ),
            onboarding_mode = ${number.onboardingMode},
            connected_at = now(),
            disconnected_at = null,
            updated_at = now()
        where id = ${existing.id} and tenant_id = ${tenantId}
        returning id, tenant_id, channel, meta_page_id, name, username, status,
          token_status, token_error, token_error_at, token_expires_at,
          waba_id, whatsapp_phone_e164, webhook_url, connected_at,
          disconnected_at, created_at, updated_at
      `
    : await insertWhatsappNumber(sql, {
        tenantId,
        number,
        displayName,
        encryptedToken,
        encryptedPin,
        pinGenerated: pinGenerated ?? false,
      })

  // Mismo cierre que Instagram: el update filtra por `tenant_id`, así que si
  // otro tenant se quedó con la fila entre la lectura y la escritura no
  // devuelve nada, y eso es el mismo conflicto de propiedad de arriba.
  if (!row) throw new PageOwnershipError(number.phoneNumberId)

  return mapConnectedPage(row)
}

// El insert, aparte, para poder envolverlo en el `try` que traduce la violación
// de unicidad sin envolver también al update (que no puede producirla).
//
// **La carrera que esto arregla.** Entre el `select` de propiedad y el insert
// hay una ventana —el driver HTTP de Neon no da transacciones interactivas—, y
// dos tenants que conectan el mismo número a la vez la atraviesan los dos: el
// primero inserta y el segundo choca contra el unique `(channel, meta_page_id)`
// de la 0013. La base aguanta, que es lo importante; lo que estaba mal era el
// mensaje. El perdedor leía «no se pudo guardar, vuelve a intentarlo» —un error
// reintentable, y reintentar no va a funcionar nunca— en vez de «ese número ya
// está conectado en otra cuenta», que es la verdad y le dice qué hacer.
//
// Se traduce al **mismo** `PageOwnershipError` del camino comprobado a
// propósito: para el llamador el desenlace es idéntico, gane o pierda la
// carrera, y no hay dos redacciones del mismo problema.
async function insertWhatsappNumber(
  sql: ReturnType<typeof getSql>,
  input: {
    tenantId: string
    number: WhatsappNumberInput
    displayName: string
    encryptedToken: string
    encryptedPin: string
    pinGenerated: boolean
  }
): Promise<ConnectedPageRow[]> {
  try {
    return await sql<ConnectedPageRow[]>`
      insert into connected_pages (
        tenant_id,
        channel,
        meta_page_id,
        name,
        page_access_token_encrypted,
        token_expires_at,
        waba_id,
        whatsapp_phone_e164,
        whatsapp_pin_encrypted,
        whatsapp_pin_generated,
        onboarding_mode
      )
      values (
        ${input.tenantId}, 'whatsapp', ${input.number.phoneNumberId},
        ${input.displayName}, ${input.encryptedToken},
        ${input.number.tokenExpiresAt}, ${input.number.wabaId},
        ${input.number.phoneE164}, ${input.encryptedPin},
        ${input.pinGenerated}, ${input.number.onboardingMode}
      )
      returning id, tenant_id, channel, meta_page_id, name, username, status,
        token_status, token_error, token_error_at, token_expires_at,
        waba_id, whatsapp_phone_e164, webhook_url, connected_at,
        disconnected_at, created_at, updated_at
    `
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PageOwnershipError(input.number.phoneNumberId)
    }
    throw error
  }
}

// El `SQLSTATE 23505` de Postgres. Mismo predicado que ya usan las rutas de
// envío (`app/api/meta/send`), replicado acá y no importado de ahí porque
// aquello es un route handler y esto es el registro de cuentas: el que se
// mueva no debería arrastrar al otro.
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  )
}

// Quién es el dueño de un `phone_number_id` de WhatsApp —**mirando todos los
// tenants**— y, solo si es este, el PIN con el que ya lo registramos.
//
// Es la consulta que el onboarding hace **antes de suscribir y registrar**, y
// contesta las dos preguntas que deciden si esas llamadas pueden ocurrir:
//
// - ¿el número ya es de otro? Entonces no se toca Meta: `/register` con el PIN
//   del intruso pisaría la verificación en dos pasos del dueño legítimo y
//   dejaría obsoleto el PIN que le guardamos, sin que él se entere.
// - ¿es una reconexión nuestra? Entonces el PIN vigente es este, y hay que
//   reusarlo: registrar con uno nuevo devuelve 133005 y le pide al cliente un
//   PIN que nos inventamos nosotros.
//
// El PIN de otro tenant **no se descifra**: la pregunta que hay que contestar es
// de quién es el número, y descifrar el secreto de un tercero para responderla
// sería sacar una credencial de la base sin ninguna razón.
//
// Sin filtrar por `status`: una conexión desconectada sigue registrada en Meta
// con su PIN, y sigue siendo de su dueño.
export type WhatsappNumberOwnership = {
  ownedByOtherTenant: boolean
  // `true` solo si la fila es de este tenant y está `active`. Lo mira el cupo
  // del plan: reconectar un número que ya está activo no pide un hueco nuevo.
  activeForTenant: boolean
  storedPin: string | null
}

export async function resolveWhatsappNumberOwnership(
  tenantId: string,
  phoneNumberId: string
): Promise<WhatsappNumberOwnership> {
  const sql = getSql()
  const [row] = await sql<
    {
      tenant_id: string
      status: PageStatus
      whatsapp_pin_encrypted: string | null
    }[]
  >`
    select tenant_id, status, whatsapp_pin_encrypted
    from connected_pages
    where channel = 'whatsapp'
      and meta_page_id = ${phoneNumberId}
    limit 1
  `

  if (!row) {
    return { ownedByOtherTenant: false, activeForTenant: false, storedPin: null }
  }
  if (row.tenant_id !== tenantId) {
    return { ownedByOtherTenant: true, activeForTenant: false, storedPin: null }
  }

  return {
    ownedByOtherTenant: false,
    activeForTenant: row.status === "active",
    storedPin: row.whatsapp_pin_encrypted
      ? decryptSecret(row.whatsapp_pin_encrypted)
      : null,
  }
}

// Cuántos números **activos** cuelgan de este WABA, sin contar los que la
// operación en curso está dando de baja.
//
// **Cuenta todos los tenants a propósito.** La suscripción al webhook cuelga del
// WABA y el WABA es compartido: desuscribirlo apaga los eventos de todos sus
// números, sean de quien sean. Filtrar por tenant acá sería reproducir el bug
// que esta consulta existe para evitar, solo que entre cuentas de Resender
// distintas —y sin ningún error visible en ninguna de las dos—.
//
// `excludeConnectionIds` es lo que hace que la respuesta sea «cuántos quedarán»
// y no «cuántos hay»: al desconectar, la fila ya está en `disconnected` cuando
// se llama (y excluirla igual no cuesta nada); al borrar la cuenta entera, en
// cambio, todas las filas del tenant siguen `active` y sin la lista ninguna
// llamada desuscribiría nunca.
export async function countActiveWhatsappNumbersInWaba(input: {
  wabaId: string
  excludeConnectionIds?: string[]
}): Promise<number> {
  const sql = getSql()
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from connected_pages
    where channel = 'whatsapp'
      and waba_id = ${input.wabaId}
      and status = 'active'
      and id <> all(${input.excludeConnectionIds ?? []}::uuid[])
  `

  return row?.count ?? 0
}

// El PIN que **generamos nosotros** para una conexión de este tenant, descifrado
// para enseñárselo. Devuelve null si el PIN lo aportó el cliente (ya lo conoce),
// si no hay ninguno, o si la conexión no es suya.
//
// Es una consulta aparte y no un campo de `listTenantPages` porque el descifrado
// tiene que ocurrir cuando alguien lo pide, no en cada render de Conexiones: un
// PIN en el payload de la pantalla es un secreto del cliente viajando en cada
// visita, esté mirándolo o no.
export async function getGeneratedWhatsappPin(
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
      and coalesce(whatsapp_pin_generated, false)
    limit 1
  `

  if (!row?.whatsapp_pin_encrypted) return null
  return decryptSecret(row.whatsapp_pin_encrypted)
}

// Cómo se llama el número en la tarjeta de Conexiones.
//
// Gana `verifiedName` —el nombre verificado del número, el mismo que ve el
// destinatario en el chat— sobre `wabaName` por dos razones. Es la identidad de
// **este** número y no la del contenedor; y un WABA puede tener varios números,
// así que usar el nombre de la cuenta dibujaría dos tarjetas con el mismo texto
// para dos números distintos, que es exactamente lo que la pantalla no puede
// permitirse cuando lo que hay que decidir ahí es cuál desconectar.
//
// El WABA queda de respaldo porque un número recién dado de alta puede no tener
// nombre verificado todavía, y detrás va el número en E.164: la tarjeta lo pinta
// igual en su propia línea, pero un `name` vacío deja el título en blanco.
function resolveWhatsappDisplayName(input: WhatsappNumberInput): string {
  return (
    input.verifiedName ??
    input.wabaName ??
    input.phoneE164 ??
    input.phoneNumberId
  )
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
      token_status, token_error, token_error_at, token_expires_at, waba_id,
      whatsapp_phone_e164, webhook_url, connected_at, disconnected_at,
      created_at, updated_at
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
    // `?? null` y no `row.waba_id` a secas: las columnas nacieron en la 0015 y
    // el tipo promete `string | null`, así que una proyección que se olvide de
    // seleccionarlas tiene que dar null y no `undefined` colado como si fuera
    // un valor.
    wabaId: row.waba_id ?? null,
    phoneE164: row.whatsapp_phone_e164 ?? null,
    webhookUrl: row.webhook_url,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
