import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildInboundPushPayload } from "@/lib/inbound/external-push"
import type { MessageRecord } from "@/lib/messages/message-log"
import type { ConnectedPageRecord } from "@/lib/pages/page-registry"

// Corre la cadena COMPLETA de migraciones contra un Postgres real embebido
// (PGlite), sin red y sin tocar la Neon de nadie. Lo que se prueba acá no se
// puede probar con mocks: que la 0016 pasa sobre una base con datos legacy
// —filas de `messages` anteriores a los adjuntos— y que los checks nuevos
// aceptan y rechazan exactamente lo que dicen aceptar y rechazar.
//
// El directorio se resuelve con `import.meta.url` y no con `process.cwd()`:
// vitest puede correr desde la raíz del monorepo o desde `apps/web`, y el test
// tiene que encontrar los .sql igual.
const MIGRATIONS_DIR = dirname(fileURLToPath(import.meta.url))

// La 0001 hace `create extension pgcrypto`; en PGlite las extensiones se
// declaran al crear la instancia.
const db = new PGlite({ extensions: { pgcrypto } })

// Ids sembrados antes de la 0016, para insertar mensajes nuevos después.
let tenantId: string
let pageId: string
let conversationId: string
// Cuántas filas tenía `api_keys` justo antes de que la 0023 la dropeara.
let apiKeyRowsBeforeDrop = 0

async function insertMessage(input: {
  text: string | null
  attachmentType?: string | null
  attachmentUrl?: string | null
  attachmentMeta?: Record<string, unknown> | null
}) {
  const result = await db.query<{
    id: string
    text: string | null
    attachment_type: string | null
    attachment_url: string | null
    attachment_meta: Record<string, unknown> | null
    created_at: string
  }>(
    `insert into messages (
       tenant_id, conversation_id, connected_page_id, contact_id,
       direction, status, text, attachment_type, attachment_url, attachment_meta
     )
     values ($1, $2, $3, 'psid_1', 'inbound', 'received', $4, $5, $6, $7)
     returning id, text, attachment_type, attachment_url, attachment_meta, created_at`,
    [
      tenantId,
      conversationId,
      pageId,
      input.text,
      input.attachmentType ?? null,
      input.attachmentUrl ?? null,
      input.attachmentMeta ? JSON.stringify(input.attachmentMeta) : null,
    ]
  )
  const row = result.rows[0]
  if (!row) throw new Error("insert did not return a row")
  return row
}

beforeAll(async () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    // El orden por nombre es el mismo que usa `scripts/migrate.mjs`.
    .sort()

  for (const file of files) {
    // Antes de la 0016 se siembra una fila legacy de `messages` —con `text`
    // not null y sin columnas de adjunto, como las que existen en producción—
    // para probar que la migración pasa sobre datos existentes.
    if (file.startsWith("0016")) {
      const user = await db.query<{ id: string }>(
        `insert into users (email, password_hash)
         values ('legacy@example.com', 'hash') returning id`
      )
      tenantId = user.rows[0]!.id

      const page = await db.query<{ id: string }>(
        `insert into connected_pages (
           tenant_id, meta_page_id, name, page_access_token_encrypted
         )
         values ($1, 'page_1', 'Main Page', 'encrypted') returning id`,
        [tenantId]
      )
      pageId = page.rows[0]!.id

      const conversation = await db.query<{ id: string }>(
        `insert into conversations (tenant_id, connected_page_id, contact_id)
         values ($1, $2, 'psid_1') returning id`,
        [tenantId, pageId]
      )
      conversationId = conversation.rows[0]!.id

      await db.query(
        `insert into messages (
           tenant_id, conversation_id, connected_page_id, contact_id,
           direction, status, text
         )
         values ($1, $2, $3, 'psid_1', 'inbound', 'received', 'hola legacy')`,
        [tenantId, conversationId, pageId]
      )
    }

    // Antes de la 0023 se siembran dos filas en `api_keys` —una activa y una
    // revocada, como las que existen en producción— para probar que el `drop
    // table` pasa sobre una tabla **con datos** y no solo sobre una vacía.
    if (file.startsWith("0023")) {
      await db.query(
        `insert into api_keys (tenant_id, label, visible_prefix, secret_hash,
                               status)
         values ($1, 'N8N', 'pk_live_aaaaaaaa', 'hash_activa', 'active'),
                ($1, 'vieja', 'pk_live_bbbbbbbb', 'hash_revocada', 'revoked')`,
        [tenantId]
      )
      const seeded = await db.query(`select id from api_keys`)
      apiKeyRowsBeforeDrop = seeded.rows.length
    }

    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  }
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("migración 0016: adjuntos en messages", () => {
  it("acepta la fila de solo texto", async () => {
    const row = await insertMessage({ text: "hola" })
    expect(row.text).toBe("hola")
    expect(row.attachment_type).toBeNull()
  })

  it("acepta la fila de solo adjunto, con text null", async () => {
    const row = await insertMessage({
      text: null,
      attachmentType: "image",
      attachmentUrl: "https://cdn.meta.test/foto.jpg",
      attachmentMeta: {},
    })
    expect(row.text).toBeNull()
    expect(row.attachment_type).toBe("image")
    expect(row.attachment_meta).toEqual({})
  })

  it("acepta la fila con texto y adjunto a la vez", async () => {
    const row = await insertMessage({
      text: "mira esto",
      attachmentType: "fallback",
      attachmentUrl: "https://ejemplo.test/nota",
      attachmentMeta: { title: "Una nota" },
    })
    expect(row.text).toBe("mira esto")
    expect(row.attachment_type).toBe("fallback")
  })

  it("acepta un adjunto sin URL, como una reserva", async () => {
    const row = await insertMessage({
      text: null,
      attachmentType: "appointment_booking",
      attachmentUrl: null,
      attachmentMeta: { booking: { bookingId: "book_1" } },
    })
    expect(row.attachment_type).toBe("appointment_booking")
    expect(row.attachment_url).toBeNull()
  })

  it("rechaza la fila vacía: sin texto y sin adjunto", async () => {
    await expect(insertMessage({ text: null })).rejects.toThrow(
      /messages_content_present_check/
    )
  })

  // `location` estaba acá hasta la 0017, que lo metió en el catálogo junto al
  // resto de lo que manda WhatsApp. El caso que este test cuida no es «este
  // tipo concreto»: es que el catálogo siga siendo cerrado, así que el valor de
  // prueba es uno que nadie va a querer agregar nunca.
  it("rechaza un attachment_type fuera del catálogo", async () => {
    await expect(
      insertMessage({
        text: null,
        attachmentType: "no_existe_este_tipo",
        attachmentUrl: "https://ejemplo.test/x",
      })
    ).rejects.toThrow(/messages_attachment_type_check/)
  })

  // Lo que se guarda en `attachment_meta` es lo que se pushea en
  // `message.attachment.details`: un solo mapeo, cuyo split inverso vive en
  // `buildInboundPushPayload`. Si alguien cambia el merge sin cambiar el
  // split, este test es el que lo delata.
  it("round-trip: attachment_meta guardado === details pusheado", async () => {
    const cases = [
      {
        type: "sticker",
        url: "https://cdn.meta.test/sticker.png",
        title: null as string | null,
        details: { stickerId: "369239263222822" },
      },
      {
        type: "appointment_booking",
        url: null as string | null,
        title: "Reserva confirmada" as string | null,
        details: {
          booking: {
            bookingId: "book_1",
            status: "CONFIRMED",
            startTime: 1700001000,
            endTime: 1700004600,
            timezone: "America/Argentina/Buenos_Aires",
          },
        },
      },
    ]

    for (const item of cases) {
      // El mismo merge que hace `insertInboundMessage`: `details` más la clave
      // `title` solo cuando hubo título.
      const stored = await insertMessage({
        text: null,
        attachmentType: item.type,
        attachmentUrl: item.url,
        attachmentMeta: item.title
          ? { ...item.details, title: item.title }
          : item.details,
      })

      const read = await db.query<{
        id: string
        text: string | null
        attachment_type: string | null
        attachment_url: string | null
        attachment_meta: Record<string, unknown> | null
        created_at: string
      }>(
        `select id, text, attachment_type, attachment_url, attachment_meta, created_at
         from messages where id = $1`,
        [stored.id]
      )
      const row = read.rows[0]!

      const message: MessageRecord = {
        id: row.id,
        tenantId,
        conversationId,
        connectedPageId: pageId,
        contactId: "psid_1",
        direction: "inbound",
        status: "received",
        text: row.text ?? "",
        metaMessageId: null,
        idempotencyKey: null,
        instagramSourceCommentId: null,
        attachmentType: row.attachment_type,
        attachmentUrl: row.attachment_url,
        attachmentMeta: row.attachment_meta,
        error: null,
        providerResponse: null,
        createdAt: new Date(row.created_at),
      }

      const page: ConnectedPageRecord = {
        id: pageId,
        tenantId,
        channel: "messenger",
        metaPageId: "page_1",
        name: "Main Page",
        username: null,
        status: "active",
        tokenStatus: "valid",
        tokenError: null,
        tokenErrorAt: null,
        tokenExpiresAt: null,
        webhookUrl: null,
        wabaId: null,
        whatsappPhoneE164: null,
        onboardingMode: null,
        coexistenceStatus: null,
        historySyncStatus: null,
        whatsappPinGenerated: false,
        hasSigningSecret: false,
        connectedAt: new Date(),
        disconnectedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const payload = buildInboundPushPayload({
        page,
        conversation: {
          id: conversationId,
          tenantId,
          connectedPageId: pageId,
          contactId: "psid_1",
          contactName: null,
          lastMessageAt: new Date(),
          lastInboundAt: null,
        },
        message,
        eventType: "message",
        postbackPayload: null,
      })

      expect(payload.message.attachment).toEqual({
        type: item.type,
        url: item.url,
        title: item.title,
        details: item.details,
      })
    }
  })
})

// Migración 0017: WhatsApp como tercer canal.
//
// Se prueba contra la cadena completa —la misma que corre `scripts/migrate.mjs`—
// porque lo que importa acá no es que el SQL sea válido, sino que pase **sobre
// datos que ya existen**: la fila legacy sembrada antes de la 0016 sigue viva
// cuando la 0017 backfillea `origin` y `last_inbound_at`.
describe("migración 0017: WhatsApp como tercer canal", () => {
  it("acepta el canal whatsapp y sigue rechazando lo que no existe", async () => {
    await expect(
      db.query(
        `insert into connected_pages (
           tenant_id, channel, meta_page_id, name, page_access_token_encrypted,
           waba_id, whatsapp_phone_e164, onboarding_mode, history_sync_status
         )
         values ($1, 'whatsapp', '1555550001', 'Soporte', 'enc',
                 'waba_1', '+5491100000000', 'coexistence', 'requested')`,
        [tenantId]
      )
    ).resolves.toBeTruthy()

    await expect(
      db.query(
        `insert into connected_pages (
           tenant_id, channel, meta_page_id, name, page_access_token_encrypted
         )
         values ($1, 'telegram', 'tg_1', 'X', 'enc')`,
        [tenantId]
      )
    ).rejects.toThrow(/connected_pages_channel_check/)
  })

  it("rechaza un onboarding_mode y un history_sync_status fuera de catálogo", async () => {
    await expect(
      db.query(
        `insert into connected_pages (
           tenant_id, channel, meta_page_id, name, page_access_token_encrypted,
           onboarding_mode
         )
         values ($1, 'whatsapp', '1555550002', 'X', 'enc', 'hibrido')`,
        [tenantId]
      )
    ).rejects.toThrow(/onboarding_mode/)

    await expect(
      db.query(
        `insert into connected_pages (
           tenant_id, channel, meta_page_id, name, page_access_token_encrypted,
           history_sync_status
         )
         values ($1, 'whatsapp', '1555550003', 'X', 'enc', 'casi')`,
        [tenantId]
      )
    ).rejects.toThrow(/history_sync_status/)
  })

  // El backfill que evita que el filtro `origin='customer'` de la ventana de
  // 24 h deje mudas todas las conversaciones que ya existían.
  it("backfillea origin en lo que ya estaba persistido", async () => {
    const rows = await db.query<{ direction: string; origin: string }>(
      `select direction, origin from messages where text = 'hola legacy'`
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toEqual({ direction: "inbound", origin: "customer" })
  })

  it("backfillea last_inbound_at desde el último entrante real", async () => {
    const rows = await db.query<{ last_inbound_at: string | null }>(
      `select last_inbound_at from conversations where id = $1`,
      [conversationId]
    )
    expect(rows.rows[0]?.last_inbound_at).not.toBeNull()
  })

  // El índice de la 0001 solo cubre `direction='inbound'`, así que sin este los
  // echoes de Business App y la mitad saliente del historial se duplicarían en
  // cada reintento de Meta.
  it("deduplica los salientes de Coexistence por wamid", async () => {
    const insertEcho = () =>
      db.query(
        `insert into messages (
           tenant_id, conversation_id, connected_page_id, contact_id,
           direction, status, text, meta_message_id, origin
         )
         values ($1, $2, $3, 'psid_1', 'outbound', 'sent', 'eco',
                 'wamid.ECHO1', 'business_app')`,
        [tenantId, conversationId, pageId]
      )

    await expect(insertEcho()).resolves.toBeTruthy()
    await expect(insertEcho()).rejects.toThrow(
      /messages_coexistence_meta_id_unique/
    )
  })

  // Un saliente nuestro comparte columnas con un echo pero **no** entra en el
  // índice parcial: si entrara, dos envíos por API sin wamid todavía asignado
  // chocarían entre sí.
  it("no mete los salientes de la API en el índice de Coexistence", async () => {
    const insertApiSend = () =>
      db.query(
        `insert into messages (
           tenant_id, conversation_id, connected_page_id, contact_id,
           direction, status, text, meta_message_id, origin
         )
         values ($1, $2, $3, 'psid_1', 'outbound', 'sent', 'hola',
                 'wamid.API1', 'resender_api')`,
        [tenantId, conversationId, pageId]
      )

    await expect(insertApiSend()).resolves.toBeTruthy()
    await expect(insertApiSend()).resolves.toBeTruthy()
  })

  it("acepta los seis tipos de adjunto que suma WhatsApp", async () => {
    for (const type of [
      "location",
      "contacts",
      "reaction",
      "interactive",
      "order",
      "system",
    ]) {
      const row = await insertMessage({ text: null, attachmentType: type })
      expect(row.attachment_type).toBe(type)
    }
  })

  it("rechaza un attachment_status fuera de los cinco estados", async () => {
    await expect(
      db.query(
        `insert into messages (
           tenant_id, conversation_id, connected_page_id, contact_id,
           direction, status, text, attachment_type, attachment_status
         )
         values ($1, $2, $3, 'psid_1', 'inbound', 'received', null,
                 'image', 'descargando')`,
        [tenantId, conversationId, pageId]
      )
    ).rejects.toThrow(/attachment_status/)
  })

  // **La propiedad de la que depende todo el borrado de media.** El resto del
  // esquema cuelga de `users` con `on delete cascade` (0002), así que en el
  // instante del DELETE no queda ninguna fila que recuerde qué hay en R2. Esta
  // tabla existe justamente para sobrevivirlo, y lo que se lo permite es **no
  // tener foreign key**. Si alguien se la agrega "por consistencia", el purgado
  // de R2 deja de tener de dónde salir y este test es el que lo delata.
  it("pending_media_deletions sobrevive al borrado de la cuenta", async () => {
    const user = await db.query<{ id: string }>(
      `insert into users (email) values ('borrame@example.com') returning id`
    )
    const doomed = user.rows[0]!.id

    await db.query(
      `insert into pending_media_deletions (r2_prefix) values ($1)`,
      [`wa/${doomed}/`]
    )

    await db.query(`delete from users where id = $1`, [doomed])

    const survivors = await db.query<{ r2_prefix: string }>(
      `select r2_prefix from pending_media_deletions where r2_prefix = $1`,
      [`wa/${doomed}/`]
    )
    expect(survivors.rows).toHaveLength(1)
  })

  it("no admite dos purgados del mismo prefijo", async () => {
    await db.query(
      `insert into pending_media_deletions (r2_prefix) values ('wa/dup/')`
    )
    await expect(
      db.query(
        `insert into pending_media_deletions (r2_prefix) values ('wa/dup/')`
      )
    ).rejects.toThrow(/r2_prefix/)
  })

  it("nace con el canal apagado para todas las cuentas, sin backfill", async () => {
    const rows = await db.query<{ whatsapp_enabled: boolean }>(
      `select whatsapp_enabled from users`
    )
    expect(rows.rows.length).toBeGreaterThan(0)
    expect(rows.rows.every((row) => row.whatsapp_enabled === false)).toBe(true)
  })
})

// Migración 0020: el esquema de Better Auth (ADR 0014).
//
// Es puramente aditiva y todavía no la lee nadie —Auth.js sigue siendo la
// autoridad de sesión—, así que lo único que hay que probar es que pasa sobre
// una base con datos previos y que las propiedades de las que va a depender el
// escalón 2 están: el backfill de `email_verified`, el default para las altas
// futuras, y que las credenciales y sesiones cuelgan del tenant con cascade.
describe("migración 0020: el esquema de Better Auth", () => {
  it("verifica a las cuentas que ya existían y deja el default en false", async () => {
    // `tenantId` se sembró antes de la 0016, así que es una fila anterior a
    // esta migración: el backfill tiene que haberla alcanzado.
    const existing = await db.query<{ email_verified: boolean; name: string }>(
      `select email_verified, name from users where id = $1`,
      [tenantId]
    )
    expect(existing.rows[0]?.email_verified).toBe(true)
    expect(existing.rows[0]?.name).toBe("")

    // Una cuenta nueva nace sin verificar: no hay canal de correo, pero el
    // default correcto para lo que venga después del deploy es `false`.
    const created = await db.query<{ email_verified: boolean; image: null }>(
      `insert into users (email) values ('nueva@example.com')
       returning email_verified, image`
    )
    expect(created.rows[0]?.email_verified).toBe(false)
    expect(created.rows[0]?.image).toBeNull()
  })

  it("no acepta una credencial de un usuario que no existe", async () => {
    await expect(
      db.query(
        `insert into auth_accounts (id, user_id, account_id, issuer, provider_id)
         values ('acc_huerfana', '00000000-0000-0000-0000-000000000000',
                 'cuenta_1', 'local:credential', 'credential')`
      )
    ).rejects.toThrow(/auth_accounts_user_id_fkey/)
  })

  it("guarda una credencial sin contraseña, como la de un proveedor social", async () => {
    await expect(
      db.query(
        `insert into auth_accounts (id, user_id, account_id, issuer, provider_id, scope)
         values ('acc_social', $1, 'google_1', 'local:oauth:google', 'google',
                 'email profile')`,
        [tenantId]
      )
    ).resolves.toBeTruthy()
  })

  // El caso siembra su propia identidad —con un `account_id` propio, para no
  // chocar con las filas que dejan los otros casos en la instancia compartida—
  // en vez de apoyarse en la que insertó el `it` anterior: así sigue pasando
  // con `it.only` o con el orden barajado.
  it("no vincula dos veces la misma identidad de un proveedor", async () => {
    await db.query(
      `insert into auth_accounts (id, user_id, account_id, issuer, provider_id)
       values ('acc_original', $1, 'google_dup_1', 'local:oauth:google',
               'google')`,
      [tenantId]
    )

    await expect(
      db.query(
        `insert into auth_accounts (id, user_id, account_id, issuer, provider_id)
         values ('acc_duplicada', $1, 'google_dup_1', 'local:oauth:google',
                 'google')`,
        [tenantId]
      )
    ).rejects.toThrow(/auth_accounts_provider_id_account_id_key/)
  })

  // `issuer` es obligatoria desde Better Auth 1.7: es la mitad de la clave por
  // la que la librería busca la credencial. Una fila sin emisor sería una
  // credencial que el login no puede encontrar, así que la base la rechaza.
  it("no guarda una credencial sin emisor", async () => {
    await expect(
      db.query(
        `insert into auth_accounts (id, user_id, account_id, provider_id)
         values ('acc_sin_issuer', $1, 'sin_issuer_1', 'credential')`,
        [tenantId]
      )
    ).rejects.toThrow(/issuer/)
  })

  // El unique autoritativo para la librería es `(issuer, account_id)`: es por
  // donde resuelve `findAccountByKey`. El caso usa dos `provider_id` distintos
  // a propósito, para que lo que rechace sea este único y no el de
  // `(provider_id, account_id)`.
  it("no vincula dos veces la misma identidad del mismo emisor", async () => {
    await db.query(
      `insert into auth_accounts (id, user_id, account_id, issuer, provider_id)
       values ('acc_emisor_1', $1, 'emisor_dup_1', 'local:oauth:google',
               'google')`,
      [tenantId]
    )

    await expect(
      db.query(
        `insert into auth_accounts (id, user_id, account_id, issuer, provider_id)
         values ('acc_emisor_2', $1, 'emisor_dup_1', 'local:oauth:google',
                 'google_legacy')`,
        [tenantId]
      )
    ).rejects.toThrow(/auth_accounts_issuer_account_id_key/)
  })

  // El cascade de la baja de cuenta borra por `user_id`; sin índice sería un
  // seq scan sobre toda la tabla de credenciales.
  it("indexa las credenciales por cuenta", async () => {
    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'auth_accounts'`
    )
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      "auth_accounts_user_id_idx"
    )
  })

  // Borrar un tenant es `delete from users` (0002) y tiene que llevarse sus
  // credenciales y sus sesiones. Sin el cascade, el borrado de cuenta fallaría
  // contra la foreign key y el producto perdería la baja.
  it("borrar la cuenta se lleva sus sesiones y sus credenciales", async () => {
    const user = await db.query<{ id: string }>(
      `insert into users (email) values ('cascade@example.com') returning id`
    )
    const doomed = user.rows[0]!.id

    await db.query(
      `insert into auth_sessions (id, user_id, token, expires_at)
       values ('ses_1', $1, 'token_1', now() + interval '7 days')`,
      [doomed]
    )
    await db.query(
      `insert into auth_accounts (id, user_id, account_id, issuer, provider_id,
                                  password)
       values ('acc_1', $1, 'cascade@example.com', 'local:credential',
               'credential', 'scrypt_hash')`,
      [doomed]
    )

    await db.query(`delete from users where id = $1`, [doomed])

    const sessions = await db.query(
      `select id from auth_sessions where user_id = $1`,
      [doomed]
    )
    const accounts = await db.query(
      `select id from auth_accounts where user_id = $1`,
      [doomed]
    )
    expect(sessions.rows).toHaveLength(0)
    expect(accounts.rows).toHaveLength(0)
  })

  it("no admite dos sesiones con el mismo token", async () => {
    const insertSession = (id: string) =>
      db.query(
        `insert into auth_sessions (id, user_id, token, expires_at)
         values ($1, $2, 'token_repetido', now() + interval '7 days')`,
        [id, tenantId]
      )

    await expect(insertSession("ses_a")).resolves.toBeTruthy()
    await expect(insertSession("ses_b")).rejects.toThrow(/token/)
  })

  // `auth_verifications` no tiene foreign key a propósito: el `identifier`
  // puede ser un email sin cuenta todavía, o un state de OAuth previo al alta.
  it("guarda una verificación de un identificador sin cuenta", async () => {
    await expect(
      db.query(
        `insert into auth_verifications (id, identifier, value, expires_at)
         values ('ver_1', 'todavia-no-existe@example.com', 'token',
                 now() + interval '1 hour')`
      )
    ).resolves.toBeTruthy()
  })
})

// Migración 0021: la contraseña se va de `users` (ADR 0014).
//
// Es la única parte destructiva del cutover y va en el mismo deploy. Lo que
// hay que probar es exactamente lo que un `drop column` puede romper: que pasa
// sobre una base **con filas** —la cuenta legacy sembrada antes de la 0016
// sigue viva— y que no se lleva por delante nada del esquema de Better Auth,
// que es lo que a partir de acá guarda las credenciales.
describe("migración 0021: la contraseña sale de users", () => {
  it("deja la cuenta legacy entera, sin la columna", async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'users'`
    )
    const names = columns.rows.map((row) => row.column_name)
    expect(names).not.toContain("password_hash")
    // Lo que sí tiene que seguir estando: el uuid es el tenant y 13 foreign
    // keys cuelgan de él.
    expect(names).toEqual(expect.arrayContaining(["id", "email", "name"]))

    const legacy = await db.query<{ id: string; email: string }>(
      `select id, email from users where id = $1`,
      [tenantId]
    )
    expect(legacy.rows[0]?.email).toBe("legacy@example.com")
  })

  // El alta de Better Auth inserta `users` sin `password_hash`. Con la columna
  // todavía ahí —`not null` y sin default, desde la 0001— reventaría contra el
  // not-null en runtime, que es por qué esta migración no puede ir después.
  it("acepta el alta que hace Better Auth, sin contraseña en users", async () => {
    const created = await db.query<{ id: string; name: string }>(
      `insert into users (id, email, name, email_verified)
       values (gen_random_uuid(), 'better-auth@example.com', 'Ada Lovelace', true)
       returning id, name`
    )
    expect(created.rows[0]?.name).toBe("Ada Lovelace")
  })

  // El drop no puede tocar las tablas `auth_*`: son las que a partir de este
  // deploy guardan la sesión y la credencial.
  it("no toca las tablas de Better Auth", async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name like 'auth_%'`
    )
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      "auth_accounts",
      // La suma la 0022, que corre después en la misma cadena.
      "auth_api_keys",
      "auth_sessions",
      "auth_verifications",
    ])
  })

  // La credencial de una cuenta que ya existía —lo que siembra
  // `scripts/seed-credentials.mjs` después del deploy— entra con el uuid
  // intacto y con los cuatro valores por los que `sign-in/email` la busca.
  it("guarda la credencial reemitida conservando el uuid del tenant", async () => {
    await db.query(
      `insert into auth_accounts (id, user_id, account_id, issuer, provider_id,
                                  password)
       values ('acc_reemitida', $1, $2, 'local:credential', 'credential',
               'salthex:keyhex')`,
      [tenantId, tenantId]
    )

    const found = await db.query<{ user_id: string; password: string }>(
      `select user_id, password from auth_accounts
       where provider_id = 'credential' and issuer = 'local:credential'
         and account_id = $1`,
      [tenantId]
    )
    expect(found.rows[0]?.user_id).toBe(tenantId)
    expect(found.rows[0]?.password).toBe("salthex:keyhex")
  })
})

// Migraciones 0022 y 0023: las API keys pasan al plugin `apiKey` (ADR 0014).
//
// Las dos viajan en el mismo deploy —`deploy.yml` corre `db:migrate` una vez— y
// por eso se prueban juntas: al terminar la cadena, `auth_api_keys` existe y
// `api_keys` ya no. Lo que hay que probar es lo que puede romper de verdad:
//
//   - Que la tabla nueva cuelga de `users` con el mismo cascade que la 0002, o
//     sea que borrar una cuenta se lleva sus keys en vez de fallar contra la FK
//     y perder la baja de cuenta.
//   - Que el `drop` de la vieja pasa sobre una tabla **con filas**, que es el
//     único caso que importa: en producción las hay.
describe("migración 0022: auth_api_keys", () => {
  it("crea la tabla con las columnas que el plugin mapea", async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'auth_api_keys'`
    )
    const names = columns.rows.map((row) => row.column_name).sort()

    // Los cuatro nombres traducidos —`label`, `visible_prefix`, `secret_hash` y
    // `last_used_at`— son los que `lib/auth/auth.ts` mapea a `name`, `start`,
    // `key` y `lastRequest`. Si alguien renombra uno de los dos lados sin el
    // otro, el INSERT del plugin revienta en runtime y esto lo ve antes.
    expect(names).toEqual(
      expect.arrayContaining([
        "config_id",
        "created_at",
        "enabled",
        "expires_at",
        "id",
        "label",
        "last_used_at",
        "secret_hash",
        "updated_at",
        "user_id",
        "visible_prefix",
      ])
    )
  })

  // `id` es texto porque `advanced.database.generateId` devuelve un uuid que
  // entra como texto en las tablas `auth_*` (0020); `user_id` es uuid porque es
  // el tenant. Son dos tipos distintos en la misma fila y confundirlos es un
  // error silencioso hasta el primer insert real.
  it("guarda el id como texto y el tenant como uuid", async () => {
    const types = await db.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_name = 'auth_api_keys'
         and column_name in ('id', 'user_id')`
    )
    const byName = Object.fromEntries(
      types.rows.map((row) => [row.column_name, row.data_type])
    )
    expect(byName.id).toBe("text")
    expect(byName.user_id).toBe("uuid")
  })

  it("rechaza una key cuyo tenant no existe", async () => {
    await expect(
      db.query(
        `insert into auth_api_keys (id, user_id, secret_hash)
         values ('key_huerfana', gen_random_uuid(), 'hash_huerfano')`
      )
    ).rejects.toThrow(/user_id|foreign key/i)
  })

  it("no admite dos keys con el mismo hash", async () => {
    const insertKey = (id: string) =>
      db.query(
        `insert into auth_api_keys (id, user_id, label, visible_prefix,
                                    secret_hash)
         values ($1, $2, 'repetida', 'pk_live_cccccccc', 'hash_repetido')`,
        [id, tenantId]
      )

    await expect(insertKey("key_hash_a")).resolves.toBeTruthy()
    await expect(insertKey("key_hash_b")).rejects.toThrow(/secret_hash/)
  })

  // El cascade de la 0002, extendido a la tabla nueva: borrar la cuenta es
  // `delete from users` y tiene que llevarse sus keys. Sin esto, el borrado de
  // cuenta fallaría contra la foreign key.
  it("borrar la cuenta se lleva sus API keys", async () => {
    const user = await db.query<{ id: string }>(
      `insert into users (email) values ('con-keys@example.com') returning id`
    )
    const doomed = user.rows[0]!.id

    // El id de la key es `text` y el del tenant es `uuid`: van en dos
    // placeholders distintos a propósito.
    await db.query(
      `insert into auth_api_keys (id, user_id, label, visible_prefix,
                                  secret_hash)
       values ($1, $2, 'la suya', 'pk_live_dddddddd', 'hash_a_borrar')`,
      ["key_de_la_cuenta_borrada", doomed]
    )

    await db.query(`delete from users where id = $1`, [doomed])

    const remaining = await db.query(
      `select id from auth_api_keys where user_id = $1`,
      [doomed]
    )
    expect(remaining.rows).toHaveLength(0)
  })

  // Los valores por defecto son los que el producto promete: la key nace activa,
  // sin expiración y sin cupo. Ver `apiKeyPlugin()` en `lib/auth/auth.ts`.
  it("una key nace activa, sin expiración y sin cupo", async () => {
    const created = await db.query<{
      config_id: string
      enabled: boolean
      expires_at: string | null
      remaining: number | null
      request_count: number
    }>(
      `insert into auth_api_keys (id, user_id, label, visible_prefix,
                                  secret_hash)
       values ($1, $2, 'recien nacida', 'pk_live_eeeeeeee', 'hash_default')
       returning config_id, enabled, expires_at, remaining, request_count`,
      ["key_defaults", tenantId]
    )
    const row = created.rows[0]!
    expect(row.config_id).toBe("default")
    expect(row.enabled).toBe(true)
    expect(row.expires_at).toBeNull()
    expect(row.remaining).toBeNull()
    expect(row.request_count).toBe(0)
  })
})

describe("migración 0023: se va api_keys", () => {
  it("dropea la tabla que tenía filas", async () => {
    // La siembra del `beforeAll` metió dos filas justo antes del drop: lo que se
    // prueba es que la migración pasa sobre datos, no sobre una tabla vacía.
    expect(apiKeyRowsBeforeDrop).toBe(2)

    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'api_keys'`
    )
    expect(tables.rows).toHaveLength(0)
  })

  // El drop no puede llevarse por delante la tabla nueva ni el resto del
  // esquema de Better Auth: son las que a partir de este deploy guardan la
  // sesión, la credencial y las API keys.
  it("no toca el esquema de Better Auth", async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name like 'auth_%'`
    )
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      "auth_accounts",
      "auth_api_keys",
      "auth_sessions",
      "auth_verifications",
    ])
  })

  // Borrar una cuenta seguía dependiendo de `api_keys` hasta la 0002; ahora que
  // la tabla no existe, la baja tiene que seguir funcionando entera.
  it("deja el borrado de cuenta funcionando sin la tabla vieja", async () => {
    const user = await db.query<{ id: string }>(
      `insert into users (email) values ('baja@example.com') returning id`
    )
    const doomed = user.rows[0]!.id

    await expect(
      db.query(`delete from users where id = $1`, [doomed])
    ).resolves.toBeTruthy()
  })
})
