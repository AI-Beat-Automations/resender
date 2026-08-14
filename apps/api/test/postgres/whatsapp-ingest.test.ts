import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type {
  WhatsappContactSyncEvent,
  WhatsappMessageEvent,
  WhatsappStatusEvent,
} from "../../src/domain/whatsapp-events"
import {
  SqlRepository,
  type PageRecord,
} from "../../src/infrastructure/db/repository"
import { createTestDatabase, type TestDatabase } from "./database"

// Ingesta de WhatsApp **contra Postgres de verdad** (PGlite), no contra un doble
// de `sql`.
//
// Estos tests existen por un 500 en producción: la sentencia de
// `ingestWhatsappInbound` tenía binds que Postgres no podía tipar
// (`could not determine data type of parameter $29`), y como falla al
// *preparar* la consulta, ni siquiera llega a ejecutarse. Los 300+ tests de
// `apps/api` seguían en verde porque `capturingSql` solo mira el texto y los
// valores: un doble nunca infiere tipos.
//
// Lo que se cubre acá, y solo se puede cubrir acá:
//
//   - que la sentencia **prepare** (todos los binds tipables);
//   - que las filas entren de verdad y respeten checks, uniques y `on conflict`;
//   - los cinco caminos del mismo SQL, porque cada uno pone binds distintos en
//     juego (nulls en sitios donde no hay columna que dé el tipo): texto,
//     adjunto, echo, histórico, status y contact sync.

let database: TestDatabase
let repository: SqlRepository
let page: PageRecord

const CREATED_AT = new Date("2026-08-13T18:00:00.000Z")
const PERIOD_START = new Date("2026-08-01T00:00:00.000Z")
const RECOVER_AFTER = new Date("2026-08-13T18:02:00.000Z")

beforeAll(async () => {
  database = await createTestDatabase()
  repository = new SqlRepository(database.sql)
})

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  // Base limpia por test: los uniques de dedupe (`wamid`) son justamente lo que
  // varios de estos casos ejercitan, y arrastrar filas entre tests haría que el
  // segundo midiera el estado del primero.
  await database.db.exec(`
    truncate table
      whatsapp_media_jobs,
      message_attachments,
      external_webhook_jobs,
      external_webhook_deliveries,
      messages,
      conversations,
      usage_counters,
      connected_pages,
      users
    restart identity cascade
  `)
  page = await seedWhatsappPage()
})

describe("ingestWhatsappInbound contra Postgres", () => {
  it("inserta un mensaje de texto entrante, su job y el consumo", async () => {
    const result = await repository.ingestWhatsappInbound(ingestInput())

    expect(result.inserted).toBe(true)
    expect(result.jobId).not.toBeNull()

    const message = await row(
      `select direction, status, message_type, text, origin, historical,
         delivery_status, meta_message_id, content, error
       from messages`
    )
    expect(message).toMatchObject({
      direction: "inbound",
      status: "received",
      message_type: "text",
      text: "hola",
      origin: "customer",
      historical: false,
      delivery_status: null,
      meta_message_id: "wamid.text.1",
      content: null,
      error: null,
    })

    // La ventana de 24 h se abre con el entrante real.
    const conversation = await row(
      `select contact_name, last_inbound_at, last_message_at from conversations`
    )
    expect(conversation.contact_name).toBe("Juana")
    expect(conversation.last_inbound_at).not.toBeNull()

    const job = await row(
      `select status, payload, webhook_url, last_error from external_webhook_jobs`
    )
    expect(job.status).toBe("pending")
    expect(job.last_error).toBeNull()
    // El sobre se arma dentro del propio SQL con `jsonb_build_object`: si algún
    // bind de ahí viajara mal tipado, esto lo delata.
    const payload = job.payload as {
      id: string
      type: string
      data: {
        page: Record<string, unknown>
        conversation: { contact: { name: string | null } }
        message: Record<string, unknown>
      }
    }
    expect(payload.type).toBe("message.received")
    expect(payload.data.page).toMatchObject({
      channel: "whatsapp",
      wabaId: "waba-1",
      phoneNumberId: "phone-number-1",
      onboardingMode: "standard",
      username: null,
    })
    expect(payload.data.conversation.contact.name).toBe("Juana")
    expect(payload.data.message).toMatchObject({
      direction: "inbound",
      type: "text",
      text: "hola",
      historical: false,
      attachments: [],
      replyTo: null,
      content: null,
      deliveryStatus: null,
    })

    const usage = await row(`select message_count from usage_counters`)
    expect(usage.message_count).toBe(1)
  })

  // El otro extremo del mismo SQL: todo lo que en el caso de texto viaja en
  // null (content, adjuntos, replyTo, caption) acá lleva valor, y al revés.
  it("inserta un adjunto con su job de descarga y lo publica en el sobre", async () => {
    const result = await repository.ingestWhatsappInbound(
      ingestInput({
        event: event({
          type: "image",
          text: "mirá esto",
          providerMessageId: "wamid.media.1",
          replyToProviderMessageId: "wamid.text.1",
          content: {
            kind: "generic_event",
            eventType: "image",
            raw: { id: "media-1" },
          },
          attachments: [
            {
              kind: "image",
              providerMediaId: "media-1",
              mimeType: "image/jpeg",
              sha256: "abc123",
              filename: null,
              caption: "mirá esto",
              voice: null,
              animated: null,
            },
          ],
        }),
      })
    )

    expect(result.inserted).toBe(true)

    const attachment = await row(
      `select id, kind, provider_media_id, mime_type, filename, caption, sha256,
         status, size_bytes
       from message_attachments`
    )
    expect(attachment).toMatchObject({
      kind: "image",
      provider_media_id: "media-1",
      mime_type: "image/jpeg",
      filename: null,
      caption: "mirá esto",
      sha256: "abc123",
      status: "pending",
      size_bytes: null,
    })

    const mediaJob = await row(`select status from whatsapp_media_jobs`)
    expect(mediaJob.status).toBe("pending")

    const job = await row(`select payload from external_webhook_jobs`)
    const message = (job.payload as { data: { message: Record<string, unknown> } })
      .data.message
    expect(message.attachments).toEqual([
      {
        id: attachment.id,
        kind: "image",
        mimeType: "image/jpeg",
        filename: null,
        caption: "mirá esto",
        sizeBytes: null,
        sha256: "abc123",
        status: "pending",
        downloadUrl: null,
      },
    ])
    expect(message.replyTo).toEqual({ providerMessageId: "wamid.text.1" })
    expect(message.content).toEqual({
      kind: "generic_event",
      eventType: "image",
      raw: { id: "media-1" },
    })
  })

  // Un adjunto sin `mime_type` en el payload de Meta: el bind entra por
  // `jsonb_to_recordset`, donde la columna `mime_type` es `not null`.
  it("le pone mime type de respaldo a un adjunto que no lo trae", async () => {
    await repository.ingestWhatsappInbound(
      ingestInput({
        event: event({
          type: "document",
          text: null,
          providerMessageId: "wamid.media.2",
          attachments: [
            {
              kind: "document",
              providerMediaId: "media-2",
              mimeType: null,
              sha256: null,
              filename: null,
              caption: null,
              voice: null,
              animated: null,
            },
          ],
        }),
      })
    )

    const attachment = await row(`select mime_type from message_attachments`)
    expect(attachment.mime_type).toBe("application/octet-stream")
  })

  it("persiste un echo de la Business App como saliente", async () => {
    const result = await repository.ingestWhatsappInbound(
      ingestInput({ event: echoEvent() })
    )

    expect(result.inserted).toBe(true)
    const message = await row(`select direction, status, origin from messages`)
    expect(message).toMatchObject({
      direction: "outbound",
      status: "sent",
      origin: "business_app",
    })
    // El echo no abre la ventana de 24 h.
    const conversation = await row(`select last_inbound_at from conversations`)
    expect(conversation.last_inbound_at).toBeNull()
    // Pero sí se entrega y sí consume cuota.
    expect(await count("external_webhook_jobs")).toBe(1)
    expect(await count("usage_counters")).toBe(1)
  })

  it("importa un histórico sin job de entrega ni consumo", async () => {
    const result = await repository.ingestWhatsappInbound(
      ingestInput({ event: historyEvent() })
    )

    expect(result.inserted).toBe(true)
    expect(result.jobId).toBeNull()
    expect(await count("messages")).toBe(1)
    expect(await count("external_webhook_jobs")).toBe(0)
    expect(await count("usage_counters")).toBe(0)
    const conversation = await row(`select last_inbound_at from conversations`)
    expect(conversation.last_inbound_at).toBeNull()
  })

  // `periodStart: null` es el tenant sin suscripción: el bind sólo aparece en
  // el `insert ... select` de `usage_counters` y en su propio `where`.
  it("no cuenta consumo cuando el tenant no tiene periodo abierto", async () => {
    const result = await repository.ingestWhatsappInbound(
      ingestInput({ periodStart: null })
    )

    expect(result.inserted).toBe(true)
    expect(await count("usage_counters")).toBe(0)
  })

  // La entrega bloqueada: `deliveryEnabled: false` mete el bind de la razón en
  // un `case`, que es de los sitios donde Postgres no tiene columna que mirar.
  it("marca el job como fallo permanente cuando la entrega está bloqueada", async () => {
    await repository.ingestWhatsappInbound(
      ingestInput({
        deliveryEnabled: false,
        deliveryBlockedReason: "plan quota exceeded",
      })
    )

    const job = await row(`select status, last_error from external_webhook_jobs`)
    expect(job).toMatchObject({
      status: "failed_permanent",
      last_error: "plan quota exceeded",
    })
  })

  it("marca el job como fallo permanente cuando la página no tiene webhook", async () => {
    await repository.ingestWhatsappInbound(
      ingestInput({ page: { ...page, webhookUrl: null } })
    )

    const job = await row(`select status, last_error from external_webhook_jobs`)
    expect(job).toMatchObject({
      status: "failed_permanent",
      last_error: "webhook URL is not configured",
    })
  })

  // El evento de sistema (`user_changed_number`): entrante y de ahora mismo,
  // pero no lo escribió el contacto, así que no abre la ventana.
  it("no abre la ventana de 24 h con un evento de sistema", async () => {
    await repository.ingestWhatsappInbound(
      ingestInput({
        event: event({
          type: "system",
          text: null,
          origin: "system",
          providerMessageId: "wamid.system.1",
          contactName: null,
          content: {
            kind: "generic_event",
            eventType: "system",
            raw: { type: "user_changed_number" },
          },
        }),
      })
    )

    const conversation = await row(`select last_inbound_at from conversations`)
    expect(conversation.last_inbound_at).toBeNull()
  })

  // El reintento de Meta: el segundo webhook con el mismo `wamid` cae en el
  // `on conflict do nothing` y sale por la relectura, que es otra sentencia con
  // sus propios binds.
  it("devuelve el mismo mensaje cuando Meta reintenta el mismo wamid", async () => {
    const first = await repository.ingestWhatsappInbound(ingestInput())
    const second = await repository.ingestWhatsappInbound(ingestInput())

    expect(second.inserted).toBe(false)
    expect(second.messageId).toBe(first.messageId)
    expect(second.jobId).toBe(first.jobId)
    expect(await count("messages")).toBe(1)
    expect(await count("usage_counters")).toBe(1)
  })

  // Un mensaje con error de Meta: `error` viaja como texto formateado y sólo
  // aparece en columnas nullable.
  it("guarda el diagnóstico de un mensaje con errores", async () => {
    await repository.ingestWhatsappInbound(
      ingestInput({
        event: event({
          direction: "outbound",
          origin: "business_app",
          providerMessageId: "wamid.failed.1",
          deliveryStatus: "failed",
          errors: [
            {
              code: 131047,
              title: "Re-engagement message",
              message: "More than 24 hours",
              details: "ventana cerrada",
            },
          ],
        }),
      })
    )

    const message = await row(`select error, delivery_status from messages`)
    expect(message.error).toContain("131047")
    expect(message.delivery_status).toBe("failed")
  })
})

describe("applyWhatsappStatus contra Postgres", () => {
  beforeEach(async () => {
    await repository.ingestWhatsappInbound(
      ingestInput({ event: echoEvent() })
    )
  })

  it("aplica el estado que reporta Meta", async () => {
    const result = await repository.applyWhatsappStatus(statusInput("delivered"))

    expect(result).toMatchObject({ updated: true, deliveryStatus: "delivered" })
    const message = await row(`select delivery_status from messages`)
    expect(message.delivery_status).toBe("delivered")
  })

  // El rank monotónico vive **dentro** del SQL (`array_position`): esto lo
  // ejecuta de verdad, en vez de reimplementarlo en JavaScript como hace el
  // test con doble.
  it("no rebaja un read con un sent que llegó tarde", async () => {
    await repository.applyWhatsappStatus(statusInput("read"))
    const late = await repository.applyWhatsappStatus(statusInput("sent"))

    expect(late.updated).toBe(false)
    expect(late.deliveryStatus).toBe("read")
    const message = await row(`select delivery_status from messages`)
    expect(message.delivery_status).toBe("read")
  })

  it("un failed sí pisa un delivered y guarda su error", async () => {
    await repository.applyWhatsappStatus(statusInput("delivered"))
    const failed = await repository.applyWhatsappStatus(
      statusInput("failed", [
        {
          code: 131026,
          title: "Message undeliverable",
          message: null,
          details: null,
        },
      ])
    )

    expect(failed.updated).toBe(true)
    const message = await row(`select delivery_status, error from messages`)
    expect(message.delivery_status).toBe("failed")
    expect(message.error).toContain("131026")
  })

  // Sin errores en el status, el bind del error viaja como null dentro de un
  // `coalesce`: el diagnóstico anterior tiene que sobrevivir.
  it("un estado sin error no borra el diagnóstico anterior", async () => {
    await repository.applyWhatsappStatus(
      statusInput("failed", [
        {
          code: 131026,
          title: "Message undeliverable",
          message: null,
          details: null,
        },
      ])
    )
    await repository.applyWhatsappStatus(statusInput("deleted"))

    const message = await row(`select delivery_status, error from messages`)
    expect(message.delivery_status).toBe("deleted")
    expect(message.error).toContain("131026")
  })

  it("ignora un wamid que no es nuestro", async () => {
    const result = await repository.applyWhatsappStatus({
      page,
      event: { ...statusInput("read").event, providerMessageId: "wamid.ajeno" },
    })

    expect(result).toEqual({
      updated: false,
      messageId: null,
      deliveryStatus: null,
    })
  })
})

describe("applyWhatsappContactSync contra Postgres", () => {
  beforeEach(async () => {
    await repository.ingestWhatsappInbound(ingestInput())
  })

  it("renombra la conversación con el nombre de la libreta del negocio", async () => {
    const result = await repository.applyWhatsappContactSync({
      page,
      event: contactEvent({ fullName: "Juana Pérez" }),
    })

    expect(result.updated).toBe(true)
    const conversation = await row(
      `select contact_name, contact_synced_at from conversations`
    )
    expect(conversation.contact_name).toBe("Juana Pérez")
    expect(conversation.contact_synced_at).not.toBeNull()
  })

  // `remove` = «lo borré de mi agenda»: el nombre se olvida y el hilo se queda.
  it("olvida el nombre en un remove sin borrar la conversación", async () => {
    const result = await repository.applyWhatsappContactSync({
      page,
      event: contactEvent({ action: "remove", fullName: null }),
    })

    expect(result.updated).toBe(true)
    const conversation = await row(`select contact_name from conversations`)
    expect(conversation.contact_name).toBeNull()
    expect(await count("conversations")).toBe(1)
  })

  // Un `add` sin nombre completo (Meta manda sólo `first_name` a veces): el
  // bind es null dentro de un `coalesce`, y el nombre que ya había manda.
  it("un add sin nombre completo conserva el que ya estaba", async () => {
    const result = await repository.applyWhatsappContactSync({
      page,
      event: contactEvent({ fullName: null }),
    })

    expect(result.updated).toBe(true)
    const conversation = await row(`select contact_name from conversations`)
    expect(conversation.contact_name).toBe("Juana")
  })

  it("no toca nada cuando el teléfono no tiene conversación", async () => {
    const result = await repository.applyWhatsappContactSync({
      page,
      event: contactEvent({ phoneNumber: "+34 600 000 000" }),
    })

    expect(result.updated).toBe(false)
  })
})

// --- datos ---

function ingestInput(
  overrides: Partial<Parameters<SqlRepository["ingestWhatsappInbound"]>[0]> = {}
): Parameters<SqlRepository["ingestWhatsappInbound"]>[0] {
  return {
    page,
    event: event(),
    // El `event_id` es unique: cada ingesta necesita el suyo, igual que en el
    // servicio real (ahí lo genera `crypto.randomUUID()`).
    eventId: `evt_${crypto.randomUUID()}`,
    payloadVersion: 1,
    periodStart: PERIOD_START,
    deliveryEnabled: true,
    deliveryBlockedReason: null,
    recoverAfter: RECOVER_AFTER,
    ...overrides,
  }
}

function event(
  overrides: Partial<WhatsappMessageEvent> = {}
): WhatsappMessageEvent {
  return {
    wabaId: "waba-1",
    providerPhoneNumberId: "phone-number-1",
    direction: "inbound",
    contactId: "5215555555555",
    senderId: "5215555555555",
    contactName: "Juana",
    providerMessageId: "wamid.text.1",
    type: "text",
    text: "hola",
    content: null,
    attachments: [],
    replyToProviderMessageId: null,
    origin: "customer",
    historical: false,
    deliveryStatus: null,
    errors: [],
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function echoEvent(
  overrides: Partial<WhatsappMessageEvent> = {}
): WhatsappMessageEvent {
  return event({
    direction: "outbound",
    origin: "business_app",
    senderId: "5215550000000",
    contactName: null,
    providerMessageId: "wamid.echo.1",
    ...overrides,
  })
}

function historyEvent(): WhatsappMessageEvent {
  return event({
    origin: "history",
    historical: true,
    deliveryStatus: "read",
    contactName: null,
    providerMessageId: "wamid.history.1",
    createdAt: new Date("2026-02-01T10:00:00.000Z"),
  })
}

function statusInput(
  deliveryStatus: WhatsappStatusEvent["deliveryStatus"],
  errors: WhatsappStatusEvent["errors"] = []
): { page: PageRecord; event: WhatsappStatusEvent } {
  return {
    page,
    event: {
      wabaId: "waba-1",
      providerPhoneNumberId: "phone-number-1",
      providerMessageId: "wamid.echo.1",
      deliveryStatus,
      recipientId: "5215555555555",
      timestamp: CREATED_AT,
      errors,
    },
  }
}

function contactEvent(
  overrides: Partial<WhatsappContactSyncEvent> = {}
): WhatsappContactSyncEvent {
  return {
    wabaId: "waba-1",
    providerPhoneNumberId: "phone-number-1",
    action: "add",
    // Con separadores y `+` a propósito: la sentencia compara por dígitos.
    phoneNumber: "+52 1 55 5555 5555",
    fullName: "Juana",
    firstName: "Juana",
    timestamp: CREATED_AT,
    ...overrides,
  }
}

async function seedWhatsappPage(): Promise<PageRecord> {
  const tenant = await row(
    `insert into users (email, password_hash)
     values ('tenant@example.test', 'hash')
     returning id`
  )
  const inserted = await row(
    `insert into connected_pages (
       tenant_id, channel, meta_page_id, name, page_access_token_encrypted,
       webhook_url, waba_id, whatsapp_phone_e164, onboarding_mode
     )
     values (
       $1, 'whatsapp', 'phone-number-1', 'Soporte', 'encrypted',
       'https://tenant.example.test/hook', 'waba-1', '+5215550000000',
       'standard'
     )
     returning id, tenant_id`,
    [tenant.id]
  )
  return {
    id: String(inserted.id),
    tenantId: String(inserted.tenant_id),
    channel: "whatsapp",
    providerPageId: "phone-number-1",
    name: "Soporte",
    username: null,
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenExpiresAt: null,
    webhookUrl: "https://tenant.example.test/hook",
    pageAccessTokenEncrypted: "encrypted",
    webhookSigningSecretEncrypted: null,
    wabaId: "waba-1",
    phoneE164: "+5215550000000",
    onboardingMode: "standard",
    coexistenceStatus: null,
    historySyncStatus: null,
    connectedAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
}

async function row(
  statement: string,
  parameters: unknown[] = []
): Promise<Record<string, unknown>> {
  const result = await database.db.query<Record<string, unknown>>(
    statement,
    parameters
  )
  const first = result.rows[0]
  if (!first) throw new Error(`sin filas: ${statement}`)
  return first
}

async function count(table: string): Promise<number> {
  const result = await row(`select count(*)::int as total from ${table}`)
  return Number(result.total)
}
