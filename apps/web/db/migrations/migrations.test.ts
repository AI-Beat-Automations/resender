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

  it("rechaza un attachment_type fuera del catálogo", async () => {
    await expect(
      insertMessage({
        text: null,
        attachmentType: "location",
        attachmentUrl: "https://maps.test/punto",
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
