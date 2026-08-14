import { describe, expect, it, vi } from "vitest"

import type {
  PageRecord,
  SqlRepository,
  SubscriptionRecord,
  UserRecord,
} from "../infrastructure/db/repository"
import type { MetaClient } from "../infrastructure/meta/client"
import { createApp } from "../http/app"
import { hmacHex } from "../infrastructure/crypto/secrets"
import { ApiService } from "./service"

// Los fixtures repiten los payloads de la documentación de Meta —mismos wamid,
// mismos números— por el mismo motivo que en el parser: un webhook probado
// contra payloads imaginados solo demuestra que coincide consigo mismo.
const WABA_ID = "102290129340398"
const PHONE_NUMBER_ID = "106540352242922"
const BUSINESS_PHONE = "15550783881"
const USER_PHONE = "16505551234"
const WAMID = "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA="
const KEY = "0000000000000000000000000000000000000000000000000000000000000000"
const PAGE_ID = "3b1f4e0a-8d61-4c92-9a77-1c53b0e2a740"
const TENANT = "6b402566-9e1d-4739-bb61-81ac615a5469"
const MESSAGE_ID = "ef55c94e-b861-4d19-9f9b-b5689028de80"
const JOB_ID = "d743db7b-d4b8-4911-bf01-c639816856fc"
const CREATED_AT = new Date("2026-07-29T18:00:00.000Z")
// El entitlement se evalúa contra el reloj de pared, así que el período factura
// alrededor de ahora: uno anclado a fechas fijas caduca y convierte cualquier
// aserción sobre la cuota en `plan_unavailable`.
const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_START = new Date(Date.now() - 15 * DAY_MS)
const PERIOD_END = new Date(Date.now() + 15 * DAY_MS)

describe("WhatsApp webhook signature", () => {
  // WhatsApp Cloud API vive en la misma app de Meta que Messenger y comparte su
  // App Secret. Instagram es la excepción —el suyo es el `client_secret` de su
  // OAuth—, así que firmar WhatsApp con el secreto de Instagram es el error que
  // esta prueba tiene que cazar.
  it("accepts the Meta App Secret and rejects the Instagram one", async () => {
    const service = whatsappService()
    const raw = JSON.stringify({ entry: [] })

    await expect(
      service.ingestWhatsappWebhook(
        raw,
        `sha256=${await hmacHex("fb-secret", raw)}`
      )
    ).resolves.toEqual({ accepted: 0 })

    await expect(
      service.ingestWhatsappWebhook(
        raw,
        `sha256=${await hmacHex("ig-secret", raw)}`
      )
    ).rejects.toMatchObject({ code: "invalid_signature" })

    await expect(
      service.ingestWhatsappWebhook(raw, null)
    ).rejects.toMatchObject({ code: "invalid_signature" })
  })
})

describe("WhatsApp inbound ingestion", () => {
  // El `phone_number_id` es el `meta_page_id` de este canal. Sin el canal en la
  // consulta, un id de página de Facebook que coincidiera resolvería al tenant
  // equivocado.
  it("resolves the account by phone_number_id against the WhatsApp channel", async () => {
    const getActivePageByProviderId = vi.fn(async () => page())
    const service = whatsappService({ getActivePageByProviderId })

    await ingest(service, inboundText())

    expect(getActivePageByProviderId).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      "whatsapp"
    )
  })

  // WhatsApp es mensajería de pleno derecho: consume cuota como Messenger, al
  // revés que Instagram.
  it("ingests a text message with its billing period and hands it to the queue", async () => {
    const ingestWhatsappInbound = vi.fn(async () => inboundResult())
    const send = vi.fn()
    const service = whatsappService({ ingestWhatsappInbound }, send)

    await expect(ingest(service, inboundText())).resolves.toEqual({
      accepted: 1,
    })
    expect(ingestWhatsappInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: PERIOD_START,
        deliveryEnabled: true,
        deliveryBlockedReason: null,
        event: expect.objectContaining({
          direction: "inbound",
          origin: "customer",
          historical: false,
          contactId: USER_PHONE,
          providerMessageId: WAMID,
          text: "Does it come in another color?",
        }),
      })
    )
    expect(send).toHaveBeenCalledWith({ jobId: JOB_ID, messageId: MESSAGE_ID })
  })

  it("carries the attachments of a media message through to persistence", async () => {
    const ingestWhatsappInbound = vi.fn(async () => inboundResult())
    const service = whatsappService({ ingestWhatsappInbound })

    await expect(ingest(service, inboundImage())).resolves.toEqual({
      accepted: 1,
    })
    expect(ingestWhatsappInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: "image",
          text: "Taj Mahal",
          attachments: [
            expect.objectContaining({
              kind: "image",
              providerMediaId: "media-1",
              mimeType: "image/jpeg",
            }),
          ],
        }),
      })
    )
  })

  // Un echo es un mensaje que el negocio mandó desde la WhatsApp Business App:
  // es un hecho real de ahora mismo, así que se entrega como cualquier otro.
  it("persists an echo from the Business App and enqueues it like any inbound", async () => {
    const ingestWhatsappInbound = vi.fn(async () => inboundResult())
    const send = vi.fn()
    const service = whatsappService({ ingestWhatsappInbound }, send)

    await expect(ingest(service, echo())).resolves.toEqual({ accepted: 1 })
    expect(ingestWhatsappInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: PERIOD_START,
        event: expect.objectContaining({
          direction: "outbound",
          origin: "business_app",
          historical: false,
          // El interlocutor es siempre el cliente, aunque el `from` del echo sea
          // el número del negocio.
          contactId: USER_PHONE,
          senderId: BUSINESS_PHONE,
        }),
      })
    )
    expect(send).toHaveBeenCalledTimes(1)
  })

  // El historial importado describe conversaciones de hace meses: reenviarlas
  // dispararía las automatizaciones del tenant sobre hechos viejos, y cobrarlas
  // vaciaría la cuota del plan en el primer minuto del onboarding.
  it("persists imported history without quota and without enqueuing it", async () => {
    const ingestWhatsappInbound = vi.fn(async () => historyResult())
    const getUsage = vi.fn(async () => 0)
    const send = vi.fn()
    const service = whatsappService({ ingestWhatsappInbound, getUsage }, send)

    await expect(ingest(service, history())).resolves.toEqual({ accepted: 1 })
    expect(ingestWhatsappInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: null,
        event: expect.objectContaining({ historical: true, origin: "history" }),
      })
    )
    // Sin período que informar, el entitlement ni siquiera se resuelve.
    expect(getUsage).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it("blocks delivery, without dropping the message, for a restricted tenant", async () => {
    const ingestWhatsappInbound = vi.fn(async () => inboundResult())
    const service = whatsappService({
      ingestWhatsappInbound,
      getUsage: async () => 50_000,
    })

    await ingest(service, inboundText())

    expect(ingestWhatsappInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryEnabled: false,
        deliveryBlockedReason: "account is restricted: quota_exceeded",
      })
    )
  })

  // Un lote de Cloud API admite hasta 1000 updates y en Coexistence suelen ser
  // todos del mismo número.
  it("resolves the account once for a batch of messages from the same number", async () => {
    const getActivePageByProviderId = vi.fn(async () => page())
    const service = whatsappService({ getActivePageByProviderId })

    await ingest(service, inboundText("wamid.uno", "wamid.dos", "wamid.tres"))

    expect(getActivePageByProviderId).toHaveBeenCalledTimes(1)
  })
})

describe("WhatsApp statuses and contact sync", () => {
  // Solo persisten: no hay nada que entregar que no viajara ya con el mensaje.
  it("applies a delivery status without enqueuing anything", async () => {
    const applyWhatsappStatus = vi.fn(async () => ({
      updated: true,
      messageId: MESSAGE_ID,
      deliveryStatus: "delivered" as const,
    }))
    const send = vi.fn()
    const service = whatsappService({ applyWhatsappStatus }, send)

    await expect(ingest(service, status())).resolves.toEqual({ accepted: 1 })
    expect(applyWhatsappStatus).toHaveBeenCalledWith({
      page: page(),
      event: expect.objectContaining({
        providerMessageId: WAMID,
        deliveryStatus: "delivered",
      }),
    })
    expect(send).not.toHaveBeenCalled()
  })

  // En Coexistence el mismo número se usa desde otras herramientas: Meta manda
  // acuses de mensajes que este tenant nunca persistió, y eso no es un error.
  it("accepts a status for a wamid that is not ours", async () => {
    const service = whatsappService({
      applyWhatsappStatus: async () => ({
        updated: false,
        messageId: null,
        deliveryStatus: null,
      }),
    })

    await expect(ingest(service, status())).resolves.toEqual({ accepted: 0 })
  })

  it("applies the business address book to the existing conversation", async () => {
    const applyWhatsappContactSync = vi.fn(async () => ({ updated: true }))
    const send = vi.fn()
    const service = whatsappService({ applyWhatsappContactSync }, send)

    await expect(ingest(service, contactSync())).resolves.toEqual({
      accepted: 1,
    })
    expect(applyWhatsappContactSync).toHaveBeenCalledWith({
      page: page(),
      event: expect.objectContaining({
        action: "add",
        phoneNumber: USER_PHONE,
        fullName: "Pablo Morales",
      }),
    })
    expect(send).not.toHaveBeenCalled()
  })
})

describe("WhatsApp events that must not reach the database", () => {
  // Lanzar haría que Meta reintentara indefinidamente un evento que no es
  // nuestro: el mismo WABA puede tener números que este tenant nunca conectó.
  it("drops events from an unconnected phone number without throwing", async () => {
    const ingestWhatsappInbound = vi.fn(async () => inboundResult())
    const service = whatsappService({
      getActivePageByProviderId: async () => null,
      ingestWhatsappInbound,
    })

    await expect(ingest(service, inboundText())).resolves.toEqual({
      accepted: 0,
    })
    expect(ingestWhatsappInbound).not.toHaveBeenCalled()
  })

  it("discards events for a tenant without product access, before persisting", async () => {
    const ingestWhatsappInbound = vi.fn(async () => inboundResult())
    const applyWhatsappStatus = vi.fn(async () => ({
      updated: true,
      messageId: MESSAGE_ID,
      deliveryStatus: "delivered" as const,
    }))
    const service = whatsappService({
      ingestWhatsappInbound,
      applyWhatsappStatus,
      getSubscription: async () => null,
    })

    await expect(ingest(service, inboundText())).resolves.toEqual({
      accepted: 0,
    })
    await expect(ingest(service, status())).resolves.toEqual({ accepted: 0 })
    expect(ingestWhatsappInbound).not.toHaveBeenCalled()
    expect(applyWhatsappStatus).not.toHaveBeenCalled()
  })

  // Un campo nuevo de Meta debe aparecer en la bitácora, no desaparecer: es la
  // única forma de enterarse sin esperar a que alguien lo eche de menos.
  it("logs the unknown field it dropped, by name, and keeps going", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const service = whatsappService()

    await expect(
      ingest(service, webhook("message_template_status_update", {}))
    ).resolves.toEqual({ accepted: 0 })
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "inbound_ingest_dropped",
        reason: "unsupported_field",
        channel: "whatsapp",
        providerField: "message_template_status_update",
      })
    )
    info.mockRestore()
  })

  // Si la cola falla, que Meta reciba 500 y reintente: el dedupe idempotente
  // hace que el reintento no duplique nada.
  it("propagates a queue failure instead of answering 200", async () => {
    const send = vi.fn(async () => {
      throw new Error("Queue unavailable")
    })
    const service = whatsappService({}, send)

    await expect(ingest(service, inboundText())).rejects.toThrow(
      "Queue unavailable"
    )
  })
})

// El canal no se conoce hasta tener la fila de la cuenta, así que el envío de
// WhatsApp solo se puede frenar después de resolver la página —y antes de tocar
// nada más—. Hasta que llegue el slice de envío, el ternario de `sendMessage`
// tiene dos ramas para tres canales y la de "no es Instagram" es la de
// Messenger: sin guard, una cuenta de WhatsApp acabaría en un POST con forma de
// Send API de Messenger contra el `phone_number_id`.
describe("envío por WhatsApp", () => {
  it("rechaza POST /v1/messages sin llamar a Meta ni reservar idempotencia", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const sendText = vi.fn()
    const reserveOutbound = vi.fn()
    const getOutboundByIdempotency = vi.fn(async () => null)
    const service = whatsappService(
      {
        getApiKeyByHash: async (secretHash: string) => ({
          id: "key_1",
          tenantId: TENANT,
          secretHash,
          status: "active" as const,
          waitlisted: false,
        }),
        touchApiKey: async () => true,
        getPage: async () => page(),
        // Todo lo que el envío necesitaría si el guard no estuviera: sin estos
        // dobles, quitarlo dejaría la prueba en rojo por un método que falta y
        // no por el 400 que se está afirmando.
        upsertConversation: async () => ({
          id: "9e2327a8-0c42-493e-bd6c-c08ed81010f0",
          tenantId: TENANT,
          pageId: PAGE_ID,
          contactId: USER_PHONE,
          contactName: null,
          lastMessageAt: CREATED_AT,
        }),
        getOutboundByIdempotency,
        reserveOutbound,
      },
      undefined,
      { sendText }
    )

    const response = await createApp({ serviceFactory: () => service }).request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          authorization: "Bearer pk_live_test",
          "content-type": "application/json",
          "Idempotency-Key": "order-1",
        },
        body: JSON.stringify({
          pageId: PAGE_ID,
          recipientId: USER_PHONE,
          type: "text",
          text: "hola",
        }),
      },
      {
        API_RATE_LIMITER: { limit: async () => ({ success: true }) },
      } as unknown as Env
    )

    expect(response.status).toBe(400)
    // El cuerpo se afirma entero y no solo el código: un 400 de validación de
    // esquema también diría `validation_error`, y este test estaría verde sin
    // guard ninguno.
    expect(await response.json()).toMatchObject({
      error: {
        code: "validation_error",
        message:
          "Sending through WhatsApp is not available yet; connect a Messenger or Instagram Page instead.",
        details: [{ path: "pageId", message: "Unsupported channel" }],
      },
    })
    // Lo que el guard evita no es solo el POST a Meta: también la reserva de
    // idempotencia, que dejaría quemada la clave del cliente y una fila
    // `failed` por un envío que nunca tuvo forma de funcionar.
    expect(sendText).not.toHaveBeenCalled()
    expect(reserveOutbound).not.toHaveBeenCalled()
    expect(getOutboundByIdempotency).not.toHaveBeenCalled()
    info.mockRestore()
    warn.mockRestore()
  })
})

// --- andamiaje --------------------------------------------------------------

function whatsappService(
  repositoryMethods: Partial<SqlRepository> = {},
  send: (payload: unknown) => unknown = () => undefined,
  // Solo lo informa la prueba de envío: el resto de este archivo no habla con
  // Meta, y pasar un cliente vacío escondería una llamada saliente inesperada
  // detrás de un `undefined is not a function`.
  metaMethods?: Partial<MetaClient>
): ApiService {
  const service = new ApiService(
    {
      API_KEY_PEPPER: "pepper",
      AUTH_SECRET: "",
      META_APP_ID: "0",
      META_APP_SECRET: "fb-secret",
      META_VERIFY_TOKEN: "fb-verify",
      INSTAGRAM_APP_ID: "0",
      INSTAGRAM_APP_SECRET: "ig-secret",
      INSTAGRAM_VERIFY_TOKEN: "ig-verify",
      WHATSAPP_VERIFY_TOKEN: "wa-verify",
      TOKEN_ENCRYPTION_KEY: KEY,
      DATABASE_URL: "postgres://test",
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
    } as unknown as Env,
    {
      repository: {
        getActivePageByProviderId: async () => page(),
        getUserById: async () => user(),
        getSubscription: async () => subscription(),
        countActivePages: async () => 1,
        getUsage: async () => 0,
        ingestWhatsappInbound: async () => inboundResult(),
        applyWhatsappStatus: async () => ({
          updated: true,
          messageId: MESSAGE_ID,
          deliveryStatus: "delivered" as const,
        }),
        applyWhatsappContactSync: async () => ({ updated: true }),
        ...repositoryMethods,
      } as unknown as SqlRepository,
      ...(metaMethods ? { meta: metaMethods as MetaClient } : {}),
      now: () => CREATED_AT,
    }
  )
  Object.defineProperty(service.env, "WEBHOOK_DELIVERIES", { value: { send } })
  return service
}

async function ingest(service: ApiService, payload: unknown) {
  const raw = JSON.stringify(payload)
  return service.ingestWhatsappWebhook(
    raw,
    `sha256=${await hmacHex("fb-secret", raw)}`
  )
}

const webhook = (field: string, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: WABA_ID,
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: BUSINESS_PHONE,
              phone_number_id: PHONE_NUMBER_ID,
            },
            ...value,
          },
          field,
        },
      ],
    },
  ],
})

const inboundText = (...ids: string[]) =>
  webhook("messages", {
    contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: USER_PHONE }],
    messages: (ids.length ? ids : [WAMID]).map((id) => ({
      from: USER_PHONE,
      id,
      timestamp: "1749416383",
      type: "text",
      text: { body: "Does it come in another color?" },
    })),
  })

const inboundImage = () =>
  webhook("messages", {
    contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: USER_PHONE }],
    messages: [
      {
        from: USER_PHONE,
        id: WAMID,
        timestamp: "1749416383",
        type: "image",
        image: {
          caption: "Taj Mahal",
          mime_type: "image/jpeg",
          sha256: "SfInY0gGKTsJlUWbwxC1k+FAD0FZHvzwfpvO0zX0GUI=",
          id: "media-1",
        },
      },
    ],
  })

const echo = () =>
  webhook("smb_message_echoes", {
    message_echoes: [
      {
        from: BUSINESS_PHONE,
        to: USER_PHONE,
        id: "wamid.eco",
        timestamp: "1739321024",
        type: "text",
        text: { body: "Sure, in blue too" },
      },
    ],
  })

const history = () =>
  webhook("history", {
    history: [
      {
        metadata: { phase: 0, chunk_order: 1, progress: 100 },
        threads: [
          {
            id: USER_PHONE,
            messages: [
              {
                from: USER_PHONE,
                id: "wamid.historico",
                timestamp: "1739230970",
                type: "text",
                text: { body: "Thanks!" },
                history_context: { status: "READ" },
              },
            ],
          },
        ],
      },
    ],
  })

const status = () =>
  webhook("messages", {
    statuses: [
      {
        id: WAMID,
        status: "delivered",
        timestamp: "1750030073",
        recipient_id: USER_PHONE,
      },
    ],
  })

const contactSync = () =>
  webhook("smb_app_state_sync", {
    state_sync: [
      {
        type: "contact",
        contact: {
          full_name: "Pablo Morales",
          first_name: "Pablo",
          phone_number: USER_PHONE,
        },
        action: "add",
        metadata: { timestamp: "1739321024" },
      },
    ],
  })

function page(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id: PAGE_ID,
    tenantId: TENANT,
    channel: "whatsapp",
    // 0015 reusa `meta_page_id` para el `phone_number_id`.
    providerPageId: PHONE_NUMBER_ID,
    name: "Resender Store",
    username: null,
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenExpiresAt: null,
    webhookUrl: "https://93.184.216.34/webhook",
    // Literal y no `encryptSecret(...)`: el cifrado lleva IV aleatorio y la
    // ingesta compara la cuenta entera contra lo que recibió el repositorio.
    // Nada de este camino descifra el token, así que un opaco basta.
    pageAccessTokenEncrypted: "encrypted-token",
    webhookSigningSecretEncrypted: "encrypted-secret",
    wabaId: WABA_ID,
    phoneE164: `+${BUSINESS_PHONE}`,
    onboardingMode: "coexistence",
    coexistenceStatus: "connected",
    historySyncStatus: "syncing",
    connectedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  }
}

function user(): UserRecord {
  return {
    id: TENANT,
    email: "tenant@example.com",
    passwordHash: "hash",
    waitlisted: false,
    createdAt: CREATED_AT,
  }
}

function subscription(): SubscriptionRecord {
  return {
    tenantId: TENANT,
    stripeSubscriptionId: "sub_1",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    lastStripeEventAt: CREATED_AT,
  }
}

function inboundResult() {
  return {
    inserted: true,
    messageId: MESSAGE_ID,
    jobId: JOB_ID,
    jobStatus: "pending" as const,
    jobAttemptCount: 0,
    jobRecoverAfter: CREATED_AT,
  }
}

// La variante de historial: sin job que encolar.
function historyResult() {
  return {
    inserted: true,
    messageId: MESSAGE_ID,
    jobId: null,
    jobStatus: null,
    jobAttemptCount: 0 as const,
    jobRecoverAfter: null,
  }
}
