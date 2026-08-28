import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildInboundPushPayload } from "@/lib/inbound/external-push"
import type { Sql } from "@/lib/db"
import type { MessageRecord } from "@/lib/messages/message-log"
import type { ConnectedPageRecord } from "@/lib/pages/page-registry"
import {
  __setSqlForTests,
  createWhatsappTemplateMirror,
  updateWhatsappTemplateCategory,
  updateWhatsappTemplateStatus,
  upsertSyncedWhatsappTemplate,
  upsertSyncedWhatsappTemplates,
} from "@/lib/whatsapp-templates/template-registry"

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

// Adapta `db.query(text, params)` de PGlite a la forma de `Sql`
// (`lib/db.ts`): un tag de template literal con placeholders `$1, $2, ...`,
// que es la misma interfaz que expone `getSql()` sobre el driver de Neon en
// producción. Existe únicamente para el describe de más abajo, que inyecta
// esto en `template-registry.ts` vía `__setSqlForTests` para ejercitar su SQL
// **real** — el mismo `on conflict` con el mismo `coalesce` — en vez de
// mockear `sql` o copiar la sentencia a mano en el test, que pasaría aunque
// el registry cambiara.
function makePgliteSql(instance: PGlite): Sql {
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce(
      (acc, chunk, i) => acc + chunk + (i < values.length ? `$${i + 1}` : ""),
      ""
    )
    const result = await instance.query(text, values)
    return result.rows
  }) as Sql

  // El camino de lote del registry (`upsertSyncedWhatsappTemplates`) sí la
  // llama. En PGlite las consultas ya se ejecutaron al construirlas —no hay
  // nada perezoso que agrupar—, así que esto no reproduce la atomicidad del
  // batch de Neon; lo que sí reproduce, que es lo que este test necesita, es
  // que las mismas sentencias corran contra Postgres de verdad.
  tag.transaction = (queries: Promise<unknown>[]) => Promise.all(queries)

  return tag
}

// Ids sembrados antes de la 0016, para insertar mensajes nuevos después.
let tenantId: string
let pageId: string
let conversationId: string

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
      `insert into users (email, password_hash)
       values ('borrame@example.com', 'hash') returning id`
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

// Migración 0018: el espejo de las plantillas de WhatsApp.
//
// El espejo es una copia de un catálogo del que Meta es dueño (ADR 0014), y las
// decisiones del esquema que lo hacen viable son justamente las que se salen de
// la costumbre del repo: la clave es de la WABA y no del tenant, el dueño se
// pone en `null` en vez de arrastrar la fila al borrar la cuenta, y el `status`
// no lleva check. Las tres se prueban acá porque las tres se «arreglan» solas en
// una revisión distraída.
describe("migración 0018: espejo de plantillas de WhatsApp", () => {
  async function insertTemplate(input: {
    wabaId?: string
    name: string
    language?: string
    status?: string
    category?: string | null
    createdByTenantId?: string | null
  }) {
    return db.query<{ id: string; status: string }>(
      `insert into whatsapp_templates (
         waba_id, name, language, status, category, created_by_tenant_id
       )
       values ($1, $2, $3, $4, $5, $6)
       returning id, status`,
      [
        input.wabaId ?? "waba_1",
        input.name,
        input.language ?? "es",
        input.status ?? "APPROVED",
        input.category ?? null,
        input.createdByTenantId ?? null,
      ]
    )
  }

  // La identidad de una plantilla en Meta es el par nombre+idioma dentro de la
  // WABA: el mismo nombre en dos idiomas son dos plantillas distintas y las dos
  // tienen que caber.
  it("admite el mismo nombre en dos idiomas y rechaza el par repetido", async () => {
    await expect(
      insertTemplate({ name: "order_update", language: "es" })
    ).resolves.toBeTruthy()
    await expect(
      insertTemplate({ name: "order_update", language: "en" })
    ).resolves.toBeTruthy()

    await expect(
      insertTemplate({ name: "order_update", language: "es" })
    ).rejects.toThrow(/whatsapp_templates_waba_id_name_language_key/)
  })

  // La misma plantilla en dos WABAs son dos filas: el catálogo es del recurso
  // compartido, no del tenant.
  it("no confunde plantillas homónimas de WABAs distintas", async () => {
    await expect(
      insertTemplate({ wabaId: "waba_2", name: "order_update", language: "es" })
    ).resolves.toBeTruthy()
  })

  // **El punto entero de que `status` no tenga check.** El catálogo de Meta no
  // es estable y `LIMIT_EXCEEDED` ni siquiera está en su lista canónica: una
  // fila que no se puede insertar perdería la plantilla entera —nombre, idioma,
  // hsm id— por no saber nombrar su estado. Lo que no reconocemos se normaliza a
  // `unknown` al leer, y `unknown` no se envía.
  it("acepta cualquier status, incluido uno fuera de la lista canónica", async () => {
    const limited = await insertTemplate({
      name: "promo_agosto",
      status: "LIMIT_EXCEEDED",
    })
    expect(limited.rows[0]?.status).toBe("LIMIT_EXCEEDED")

    const invented = await insertTemplate({
      name: "promo_septiembre",
      status: "SOMETHING_META_INVENTED",
    })
    expect(invented.rows[0]?.status).toBe("SOMETHING_META_INVENTED")
  })

  // La categoría sí es catálogo cerrado, al revés que el estado: la elegimos
  // nosotros al crear la plantilla, no nos la empuja Meta.
  it("rechaza una categoría fuera de catálogo", async () => {
    await expect(
      insertTemplate({ name: "cat_mala", category: "promocional" })
    ).rejects.toThrow(/whatsapp_templates_category_check/)
  })

  // **La propiedad que separa a esta tabla del resto del esquema.** Todo cuelga
  // de `users` con `on delete cascade` (0002); acá el cascade borraría una fila
  // que describe una plantilla que **sigue existiendo en Meta** y que otro
  // tenant de la misma WABA puede estar enviando. Al perder el dueño la fila
  // sobrevive y queda read-only para todos, que es el resultado correcto.
  it("al borrar la cuenta dueña deja la plantilla huérfana, no la borra", async () => {
    const user = await db.query<{ id: string }>(
      `insert into users (email, password_hash)
       values ('duena@example.com', 'hash') returning id`
    )
    const owner = user.rows[0]!.id

    await insertTemplate({
      name: "plantilla_de_la_duena",
      createdByTenantId: owner,
    })

    await db.query(`delete from users where id = $1`, [owner])

    const rows = await db.query<{ created_by_tenant_id: string | null }>(
      `select created_by_tenant_id from whatsapp_templates where name = $1`,
      ["plantilla_de_la_duena"]
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]?.created_by_tenant_id).toBeNull()
  })

  // La fila que deja un envío de plantilla: `text = ''`, sin adjunto —una
  // plantilla **no** es un adjunto, y el `template` de `attachment_type` es la
  // tarjeta de Messenger— y el jsonb con lo que se envió de verdad.
  it("persiste un envío de plantilla con template_meta y sin adjunto", async () => {
    const templateMeta = {
      name: "order_update",
      language: "es",
      components: [
        { type: "body", parameters: [{ type: "text", text: "A-1042" }] },
      ],
    }

    const inserted = await db.query<{
      text: string | null
      attachment_type: string | null
      template_meta: Record<string, unknown> | null
    }>(
      `insert into messages (
         tenant_id, conversation_id, connected_page_id, contact_id,
         direction, status, text, origin, template_meta
       )
       values ($1, $2, $3, 'psid_1', 'outbound', 'sent', '', 'resender_api', $4)
       returning text, attachment_type, template_meta`,
      [tenantId, conversationId, pageId, JSON.stringify(templateMeta)]
    )

    const row = inserted.rows[0]!
    expect(row.text).toBe("")
    expect(row.attachment_type).toBeNull()
    expect(row.template_meta).toEqual(templateMeta)
  })
})

// Hermano del describe de la 0018: el `coalesce` del `on conflict` de
// `upsertWhatsappTemplateRow` (`lib/whatsapp-templates/template-registry.ts`),
// que es la garantía que pide el issue #79 — «que un segundo sync no vuelva
// ajena una plantilla propia». El schema ya está migrado por el `beforeAll` de
// arriba; acá sólo se inyecta `makePgliteSql(db)` en el registry para correr
// sus funciones exportadas tal cual las llama el código real.
describe("template-registry: el on conflict de upsertWhatsappTemplateRow (issue #79)", () => {
  beforeAll(() => {
    __setSqlForTests(makePgliteSql(db))
  })

  afterAll(() => {
    __setSqlForTests(undefined)
  })

  // El caso que el ticket nombra con todas las letras.
  it("un sync inserta una plantilla sin dueño, el tenant la reclama, y un segundo sync no se la quita", async () => {
    const user = await db.query<{ id: string }>(
      `insert into users (email, password_hash)
       values ('reclama-plantilla@example.com', 'hash') returning id`
    )
    const owner = user.rows[0]!.id

    const synced = await upsertSyncedWhatsappTemplate({
      wabaId: "waba_reclamo",
      name: "bienvenida",
      language: "es",
      status: "APPROVED",
      category: "utility",
      metaTemplateId: "hsm_reclamo_1",
    })
    expect(synced.createdByTenantId).toBeNull()

    const claimed = await createWhatsappTemplateMirror({
      wabaId: "waba_reclamo",
      name: "bienvenida",
      language: "es",
      status: "APPROVED",
      category: "utility",
      metaTemplateId: "hsm_reclamo_1",
      createdByTenantId: owner,
    })
    expect(claimed.createdByTenantId).toBe(owner)

    // El segundo sync: mismo camino que el primero, sin dueño en el input.
    const secondSync = await upsertSyncedWhatsappTemplate({
      wabaId: "waba_reclamo",
      name: "bienvenida",
      language: "es",
      status: "APPROVED",
      category: "utility",
      metaTemplateId: "hsm_reclamo_1",
    })
    expect(secondSync.createdByTenantId).toBe(owner)

    // El caso que de verdad distingue las dos direcciones del `coalesce`: acá
    // los dos lados del `on conflict` son no-null (dueño existente vs. un
    // segundo reclamo), y sólo la dirección correcta —«el dueño existente
    // siempre gana»— deja pasar esto. Con `excluded` ganando, este segundo
    // reclamo le robaría la plantilla al dueño real.
    const other = await db.query<{ id: string }>(
      `insert into users (email, password_hash)
       values ('otro-tenant@example.com', 'hash') returning id`
    )
    const intruder = other.rows[0]!.id

    const secondClaim = await createWhatsappTemplateMirror({
      wabaId: "waba_reclamo",
      name: "bienvenida",
      language: "es",
      status: "APPROVED",
      category: "utility",
      metaTemplateId: "hsm_reclamo_1",
      createdByTenantId: intruder,
    })
    expect(secondClaim.createdByTenantId).toBe(owner)
  })

  // El `unique (waba_id, name, language)` de la 0018 es lo que hace posible la
  // idempotencia; lo que se fija acá es que el upsert la use (y no un
  // insert-o-falla) y que sí mueva el `status` cuando Meta lo cambió.
  it("un segundo sync es idempotente: no duplica la fila y actualiza el status", async () => {
    await upsertSyncedWhatsappTemplate({
      wabaId: "waba_idempotencia",
      name: "recordatorio",
      language: "es",
      status: "PENDING",
      category: "utility",
      metaTemplateId: "hsm_idem_1",
    })

    const second = await upsertSyncedWhatsappTemplate({
      wabaId: "waba_idempotencia",
      name: "recordatorio",
      language: "es",
      status: "APPROVED",
      category: "utility",
      metaTemplateId: "hsm_idem_1",
    })
    expect(second.status).toBe("APPROVED")

    const rows = await db.query(
      `select id from whatsapp_templates
       where waba_id = 'waba_idempotencia'
         and name = 'recordatorio' and language = 'es'`
    )
    expect(rows.rows).toHaveLength(1)
  })

  // **El camino de lote, que es por donde entra el sync de verdad.** El de una
  // fila lo cubre el test de arriba, pero el job nunca lo usa: escribe con
  // `upsertSyncedWhatsappTemplates`, que agrupa en `sql.transaction` para no
  // gastar una subrequest de Workers por plantilla. Los dos comparten la misma
  // sentencia justamente para que la regla del dueño no pueda divergir, y esto
  // es lo que lo fija contra Postgres: si alguien vuelve a separarlos, el lote
  // le saca el dueño a la plantilla propia y sólo este test lo ve.
  it("un lote tampoco vuelve ajena una plantilla propia", async () => {
    const user = await db.query<{ id: string }>(
      `insert into users (email, password_hash)
       values ('lote-plantillas@example.com', 'hash') returning id`
    )
    const owner = user.rows[0]!.id

    await createWhatsappTemplateMirror({
      wabaId: "waba_lote",
      name: "propia",
      language: "es",
      status: "APPROVED",
      category: "utility",
      metaTemplateId: "hsm_lote_propia",
      createdByTenantId: owner,
    })

    // El sync ve la propia y una ajena, en la misma corrida: es el caso real
    // —el catálogo de la WABA es compartido— y el que asegura que el lote
    // escribe las dos sin confundir sus dueños.
    await upsertSyncedWhatsappTemplates([
      {
        wabaId: "waba_lote",
        name: "propia",
        language: "es",
        status: "PAUSED",
        category: "utility",
        metaTemplateId: "hsm_lote_propia",
      },
      {
        wabaId: "waba_lote",
        name: "ajena",
        language: "es",
        status: "APPROVED",
        category: "marketing",
        metaTemplateId: "hsm_lote_ajena",
      },
    ])

    const rows = await db.query<{
      name: string
      status: string
      created_by_tenant_id: string | null
    }>(
      `select name, status, created_by_tenant_id from whatsapp_templates
       where waba_id = 'waba_lote' order by name asc`
    )

    // La ajena entra sin dueño; la propia conserva el suyo y **sí** mueve el
    // estado, que es lo único que el sync tiene derecho a cambiar.
    expect(rows.rows).toEqual([
      { name: "ajena", status: "APPROVED", created_by_tenant_id: null },
      { name: "propia", status: "PAUSED", created_by_tenant_id: owner },
    ])
  })

  // El lote también canoniza el idioma, y con la misma función: la clave del
  // `on conflict` es `(waba_id, name, language)`, así que un `pt-BR` sin
  // canonizar duplicaría la fila de una plantilla que ya conocíamos en vez de
  // actualizarla —y la copia nueva nacería sin dueño—.
  it("un lote canoniza el idioma, así que no duplica la fila que ya existía", async () => {
    await upsertSyncedWhatsappTemplate({
      wabaId: "waba_lote_idioma",
      name: "aviso",
      language: "pt_BR",
      status: "PENDING",
      category: "utility",
      metaTemplateId: "hsm_lote_idioma",
    })

    await upsertSyncedWhatsappTemplates([
      {
        wabaId: "waba_lote_idioma",
        name: "aviso",
        // La forma con guion, que es como lo escriben los webhooks de Meta.
        language: "pt-BR",
        status: "APPROVED",
        category: "utility",
        metaTemplateId: "hsm_lote_idioma",
      },
    ])

    const rows = await db.query<{ language: string; status: string }>(
      `select language, status from whatsapp_templates
       where waba_id = 'waba_lote_idioma'`
    )
    expect(rows.rows).toEqual([{ language: "pt_BR", status: "APPROVED" }])
  })

  // El mismo `coalesce` protege `meta_template_id` y `category`, no sólo el
  // dueño: una página de Graph sin categoría o sin hsm id no puede vaciar lo
  // que una página anterior sí trajo.
  it("el coalesce no pisa meta_template_id ni category con null cuando una página de Graph venga sin ellos", async () => {
    await upsertSyncedWhatsappTemplate({
      wabaId: "waba_pagina_parcial",
      name: "envio_confirmado",
      language: "es",
      status: "APPROVED",
      category: "marketing",
      metaTemplateId: "hsm_pagina_1",
    })

    // Una página sin `category` ni `id` — el caso que documenta el
    // `coalesce` en el registry.
    const second = await upsertSyncedWhatsappTemplate({
      wabaId: "waba_pagina_parcial",
      name: "envio_confirmado",
      language: "es",
      status: "APPROVED",
    })

    expect(second.category).toBe("marketing")
    expect(second.metaTemplateId).toBe("hsm_pagina_1")
  })
})

// Hallazgo N2 de la revisión del issue #79: el webhook trae el hsm id
// (`message_template_id`) y hasta ahora nadie lo escribía. Una fila del espejo
// que quedó sin `meta_template_id` no lo recuperaba nunca por este camino, y
// como el borrado y la edición van por `hsm_id`, esa plantilla quedaba
// ineditable e imborrable —409 `template_missing_meta_id`— hasta el próximo
// sync completo. Mismo patrón de infraestructura que el describe anterior:
// PGlite con el schema migrado, `__setSqlForTests` para correr el SQL real del
// registry en vez de mockearlo, que para un `coalesce` no demuestra nada.
describe("template-registry: relleno de meta_template_id desde webhooks (issue #79, N2)", () => {
  beforeAll(() => {
    __setSqlForTests(makePgliteSql(db))
  })

  afterAll(() => {
    __setSqlForTests(undefined)
  })

  it("un evento de status rellena meta_template_id cuando el espejo lo tenía en null", async () => {
    await upsertSyncedWhatsappTemplate({
      wabaId: "waba_relleno_status",
      name: "confirmacion_envio",
      language: "es",
      status: "PENDING",
      category: "utility",
      // Sin metaTemplateId: el sync que dejó el hueco (una página de Graph sin
      // hsm id, o una fila creada a mano).
    })

    const updated = await updateWhatsappTemplateStatus({
      wabaId: "waba_relleno_status",
      name: "confirmacion_envio",
      language: "es",
      status: "APPROVED",
      metaTemplateId: "hsm_webhook_1",
    })

    expect(updated?.metaTemplateId).toBe("hsm_webhook_1")
    expect(updated?.status).toBe("APPROVED")
  })

  it("un evento de status no pisa un meta_template_id que ya estaba", async () => {
    await upsertSyncedWhatsappTemplate({
      wabaId: "waba_no_pisa_status",
      name: "confirmacion_pago",
      language: "es",
      status: "PENDING",
      category: "utility",
      metaTemplateId: "hsm_de_graph",
    })

    const updated = await updateWhatsappTemplateStatus({
      wabaId: "waba_no_pisa_status",
      name: "confirmacion_pago",
      language: "es",
      status: "APPROVED",
      // El webhook trae otro id: no debería ganar, porque el que ya está vino
      // de Graph directo y merece más confianza que un campo suelto de un
      // webhook.
      metaTemplateId: "hsm_del_webhook_no_deberia_ganar",
    })

    expect(updated?.metaTemplateId).toBe("hsm_de_graph")
  })

  it("un evento de categoría rellena meta_template_id cuando el espejo lo tenía en null", async () => {
    await upsertSyncedWhatsappTemplate({
      wabaId: "waba_relleno_categoria",
      name: "bienvenida_v2",
      language: "es",
      status: "APPROVED",
      category: "utility",
    })

    const updated = await updateWhatsappTemplateCategory({
      wabaId: "waba_relleno_categoria",
      name: "bienvenida_v2",
      language: "es",
      category: "marketing",
      metaTemplateId: "hsm_webhook_categoria_1",
    })

    expect(updated?.metaTemplateId).toBe("hsm_webhook_categoria_1")
    expect(updated?.category).toBe("marketing")
  })

  it("un evento de categoría no pisa un meta_template_id que ya estaba", async () => {
    await upsertSyncedWhatsappTemplate({
      wabaId: "waba_no_pisa_categoria",
      name: "bienvenida_v3",
      language: "es",
      status: "APPROVED",
      category: "utility",
      metaTemplateId: "hsm_de_graph_2",
    })

    const updated = await updateWhatsappTemplateCategory({
      wabaId: "waba_no_pisa_categoria",
      name: "bienvenida_v3",
      language: "es",
      category: "marketing",
      metaTemplateId: "hsm_del_webhook_no_deberia_ganar_2",
    })

    expect(updated?.metaTemplateId).toBe("hsm_de_graph_2")
  })
})
