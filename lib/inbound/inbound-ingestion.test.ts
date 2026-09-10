import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getActivePageByMetaPageId: vi.fn(),
  hasActiveSubscription: vi.fn(),
  resolveInstagramAccess: vi.fn(),
  resolveWhatsappAccess: vi.fn(),
  getTenantEntitlement: vi.fn(),
  incrementUsage: vi.fn(),
  upsertConversation: vi.fn(),
  insertInboundMessage: vi.fn(),
  insertCoexistenceMessage: vi.fn(),
  updateDeliveryStatus: vi.fn(),
  queueSend: vi.fn(),
  insertInboundComment: vi.fn(),
  isOwnPublishedComment: vi.fn(),
  enqueueDelivery: vi.fn(),
  recordSkippedDelivery: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/pages/page-registry", () => ({
  getActivePageByMetaPageId: mocks.getActivePageByMetaPageId,
}))

vi.mock("@/lib/billing/subscription", () => ({
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

vi.mock("@/lib/auth/channel-access", () => ({
  resolveInstagramAccess: mocks.resolveInstagramAccess,
  resolveWhatsappAccess: mocks.resolveWhatsappAccess,
}))

vi.mock("@/lib/billing/entitlement-status", () => ({
  getTenantEntitlement: mocks.getTenantEntitlement,
}))

vi.mock("@/lib/billing/usage-counter", () => ({
  incrementUsage: mocks.incrementUsage,
}))

vi.mock("@/lib/messages/message-log", () => ({
  upsertConversation: mocks.upsertConversation,
  insertInboundMessage: mocks.insertInboundMessage,
  insertCoexistenceMessage: mocks.insertCoexistenceMessage,
  updateDeliveryStatus: mocks.updateDeliveryStatus,
}))

// La cola de WhatsApp es un binding de Cloudflare: fuera del Worker no existe,
// así que el contexto se mockea entero. Lo que se afirma es el cuerpo del job,
// que es el contrato con el consumidor (`WhatsappJobMessage`).
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { WHATSAPP_JOBS: { send: mocks.queueSend } },
  }),
}))

vi.mock("./external-push", () => ({
  buildInboundPushPayload: () => ({ payload: true }),
  buildInboundCommentPayload: () => ({ payload: true }),
  recordSkippedDelivery: mocks.recordSkippedDelivery,
}))

vi.mock("./webhook-delivery", () => ({
  enqueueDelivery: mocks.enqueueDelivery,
}))

vi.mock("@/lib/comments/comment-log", () => ({
  insertInboundComment: mocks.insertInboundComment,
  isOwnPublishedComment: mocks.isOwnPublishedComment,
}))

// El logger se mockea pero `accountFields` queda real: es el proyector que
// garantiza que «cuenta» esté completa, y mockearlo haría que los tests pasaran
// con líneas a las que les falta el `channel`.
vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

vi.mock("@/lib/posthog", () => ({ posthog: null, captureDeferred: vi.fn() }))

import {
  ingestInstagramWebhookPayload as ingestInstagramRaw,
  ingestMetaWebhookPayload as ingestMetaRaw,
  ingestWhatsappWebhookPayload as ingestWhatsappRaw,
} from "./inbound-ingestion"

// El `requestId` lo genera la ruta y se pasa explícito hasta el closure del
// `pushJob`. Los tests lo fijan para que las aserciones no dependan de un uuid.
const REQUEST_ID = "req-test"
const ingestInstagramWebhookPayload = (body: unknown) =>
  ingestInstagramRaw(body, REQUEST_ID)
const ingestMetaWebhookPayload = (body: unknown) =>
  ingestMetaRaw(body, REQUEST_ID)
const ingestWhatsappWebhookPayload = (body: unknown) =>
  ingestWhatsappRaw(body, REQUEST_ID)

const IG_ACCOUNT = "17841400000000000"
const FB_PAGE = "104233889761204"

const instagramPayload = (message: Record<string, unknown>) => ({
  object: "instagram",
  entry: [
    {
      id: IG_ACCOUNT,
      messaging: [
        {
          sender: { id: "igsid-1" },
          timestamp: 1_769_000_000_000,
          message,
        },
      ],
    },
  ],
})

const messengerPayload = () => ({
  entry: [
    {
      id: FB_PAGE,
      messaging: [
        {
          sender: { id: "psid-1" },
          timestamp: 1_769_000_000_000,
          message: { mid: "mid-fb", text: "hola" },
        },
      ],
    },
  ],
})

const page = (overrides: Record<string, unknown> = {}) => ({
  id: "page-row",
  tenantId: "tenant-1",
  channel: "messenger",
  metaPageId: FB_PAGE,
  name: "Main Page",
  username: null,
  webhookUrl: "https://example.com/hook",
  ...overrides,
})

const unrestricted = { block: null, periodStart: new Date("2026-08-01") }
const restricted = {
  block: { code: "quota_exceeded", status: 402, message: "sin cuota" },
  periodStart: new Date("2026-08-01"),
}

describe("ingesta de entrantes por canal", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(true)
    mocks.getTenantEntitlement.mockResolvedValue(unrestricted)
    mocks.upsertConversation.mockResolvedValue({
      id: "conversation-1",
      contactId: "igsid-1",
    })
    mocks.insertInboundMessage.mockResolvedValue({
      message: { id: "message-1", tenantId: "tenant-1" },
      inserted: true,
    })
    mocks.getActivePageByMetaPageId.mockResolvedValue(
      page({ channel: "instagram", metaPageId: IG_ACCOUNT })
    )
  })

  // Sin el canal, un IG ID que coincida con un page id resolvería al tenant
  // equivocado. Cada webhook impone el suyo.
  it("resuelve la cuenta contra el canal del webhook que recibió el evento", async () => {
    await ingestInstagramWebhookPayload(
      instagramPayload({ mid: "mid-1", text: "hola" })
    )
    expect(mocks.getActivePageByMetaPageId).toHaveBeenCalledWith(
      IG_ACCOUNT,
      "instagram"
    )

    mocks.getActivePageByMetaPageId.mockResolvedValue(page())
    await ingestMetaWebhookPayload(messengerPayload())
    expect(mocks.getActivePageByMetaPageId).toHaveBeenLastCalledWith(
      FB_PAGE,
      "messenger"
    )
  })

  it("descarta el evento cuando la cuenta no está conectada", async () => {
    mocks.getActivePageByMetaPageId.mockResolvedValue(null)

    await expect(
      ingestInstagramWebhookPayload(
        instagramPayload({ mid: "mid-1", text: "hola" })
      )
    ).resolves.toEqual([])
    expect(mocks.insertInboundMessage).not.toHaveBeenCalled()
  })

  // ADR 0002: el gate de suscripción sí aplica a Instagram, a diferencia de la
  // cuota y del cupo de páginas.
  it("descarta sin persistir cuando el tenant no tiene suscripción activa", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    await expect(
      ingestInstagramWebhookPayload(
        instagramPayload({ mid: "mid-1", text: "hola" })
      )
    ).resolves.toEqual([])
    expect(mocks.insertInboundMessage).not.toHaveBeenCalled()
  })

  it("filtra el eco antes de tocar la base", async () => {
    await expect(
      ingestInstagramWebhookPayload(
        instagramPayload({ mid: "mid-echo", text: "eco", is_echo: true })
      )
    ).resolves.toEqual([])
    expect(mocks.getActivePageByMetaPageId).not.toHaveBeenCalled()
  })
})

// ADR 0011: Instagram entra a facturación completo. Sus entrantes suman al
// contador del período y dejan de reenviarse cuando el tenant está restringido,
// exactamente igual que los de Messenger.
describe("Instagram dentro de facturación", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(true)
    mocks.getTenantEntitlement.mockResolvedValue(unrestricted)
    mocks.upsertConversation.mockResolvedValue({ id: "conversation-1" })
    mocks.insertInboundMessage.mockResolvedValue({
      message: { id: "message-1", tenantId: "tenant-1" },
      inserted: true,
    })
    mocks.getActivePageByMetaPageId.mockResolvedValue(
      page({ channel: "instagram", metaPageId: IG_ACCOUNT })
    )
  })

  it("cuenta el DM contra la cuota del período", async () => {
    await ingestInstagramWebhookPayload(
      instagramPayload({ mid: "mid-1", text: "hola" })
    )

    expect(mocks.incrementUsage).toHaveBeenCalledWith(
      "tenant-1",
      unrestricted.periodStart
    )
  })

  // Un comentario entrante persistido cuenta igual que un DM, sin excepción:
  // es la mitad de la regla que la ADR 0011 escribió sin asteriscos.
  it("cuenta el comentario entrante contra la cuota del período", async () => {
    mocks.isOwnPublishedComment.mockResolvedValue(false)
    mocks.insertInboundComment.mockResolvedValue({
      comment: comment(),
      inserted: true,
    })

    await ingestInstagramWebhookPayload(
      commentPayload({
        id: "ig-comment-1",
        from: { id: "9876543210", username: "un_seguidor" },
        text: "qué bueno",
        media: { id: "media-1" },
      })
    )

    expect(mocks.incrementUsage).toHaveBeenCalledWith(
      "tenant-1",
      unrestricted.periodStart
    )
  })

  // [Cuenta restringida] corta Instagram igual que Messenger: el DM se
  // persiste y se contabiliza, pero deja de reenviarse al webhook.
  it("deja de reenviar el DM con el tenant restringido, pero persiste igual", async () => {
    mocks.getTenantEntitlement.mockResolvedValue(restricted)

    const [ingested] = await ingestInstagramWebhookPayload(
      instagramPayload({ mid: "mid-1", text: "hola" })
    )
    await ingested!.pushJob()

    expect(mocks.insertInboundMessage).toHaveBeenCalledTimes(1)
    expect(mocks.recordSkippedDelivery).toHaveBeenCalledWith(
      { kind: "message", id: "message-1" },
      expect.objectContaining({ logReason: "account_restricted" })
    )
    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()
  })

  it("deja de reenviar el comentario con el tenant restringido, pero persiste igual", async () => {
    mocks.getTenantEntitlement.mockResolvedValue(restricted)
    mocks.isOwnPublishedComment.mockResolvedValue(false)
    mocks.insertInboundComment.mockResolvedValue({
      comment: comment(),
      inserted: true,
    })

    const [ingested] = await ingestInstagramWebhookPayload(
      commentPayload({
        id: "ig-comment-1",
        from: { id: "9876543210", username: "un_seguidor" },
        text: "qué bueno",
        media: { id: "media-1" },
      })
    )
    await ingested!.pushJob()

    expect(mocks.insertInboundComment).toHaveBeenCalledTimes(1)
    expect(mocks.recordSkippedDelivery).toHaveBeenCalledWith(
      { kind: "comment", id: "comment-row" },
      expect.objectContaining({
        reason:
          "account is restricted: quota exhausted or too many connected Pages",
        logReason: "account_restricted",
      })
    )
    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()
  })

  // Los dos gates que están **antes** de la medición siguen ganando: el
  // entrante del tenant sin suscripción o sin permiso de canal no se persiste
  // ni se cuenta, esté restringido o no.
  it("el gate de suscripción y el permiso de canal ganan sobre la restricción", async () => {
    mocks.getTenantEntitlement.mockResolvedValue(restricted)
    mocks.hasActiveSubscription.mockResolvedValue(false)

    await expect(
      ingestInstagramWebhookPayload(
        instagramPayload({ mid: "mid-1", text: "hola" })
      )
    ).resolves.toEqual([])

    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(false)

    await expect(
      ingestInstagramWebhookPayload(
        instagramPayload({ mid: "mid-2", text: "hola" })
      )
    ).resolves.toEqual([])

    expect(mocks.insertInboundMessage).not.toHaveBeenCalled()
    expect(mocks.incrementUsage).not.toHaveBeenCalled()
  })

  it("registra el salto cuando la cuenta de Instagram no tiene webhookUrl", async () => {
    mocks.getActivePageByMetaPageId.mockResolvedValue(
      page({ channel: "instagram", metaPageId: IG_ACCOUNT, webhookUrl: null })
    )

    const [ingested] = await ingestInstagramWebhookPayload(
      instagramPayload({ mid: "mid-1", text: "hola" })
    )
    await ingested!.pushJob()

    expect(mocks.recordSkippedDelivery).toHaveBeenCalledWith(
      { kind: "message", id: "message-1" },
      expect.objectContaining({ context: expect.anything() })
    )
    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()
  })

  it("no reenvía dos veces el mismo mid: el dedupe corta antes del push", async () => {
    mocks.insertInboundMessage.mockResolvedValue({
      message: { id: "message-1", tenantId: "tenant-1" },
      inserted: false,
    })

    await expect(
      ingestInstagramWebhookPayload(
        instagramPayload({ mid: "mid-1", text: "hola" })
      )
    ).resolves.toEqual([])
  })
})

describe("Messenger sigue medido", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(true)
    mocks.upsertConversation.mockResolvedValue({ id: "conversation-1" })
    mocks.insertInboundMessage.mockResolvedValue({
      message: { id: "message-1", tenantId: "tenant-1" },
      inserted: true,
    })
    mocks.getActivePageByMetaPageId.mockResolvedValue(page())
  })

  it("cuenta el entrante contra la cuota del período", async () => {
    mocks.getTenantEntitlement.mockResolvedValue(unrestricted)

    await ingestMetaWebhookPayload(messengerPayload())

    expect(mocks.incrementUsage).toHaveBeenCalledWith(
      "tenant-1",
      unrestricted.periodStart
    )
  })

  it("deja de reenviar cuando el tenant está restringido, pero persiste igual", async () => {
    mocks.getTenantEntitlement.mockResolvedValue(restricted)

    const [ingested] = await ingestMetaWebhookPayload(messengerPayload())
    await ingested!.pushJob()

    expect(mocks.insertInboundMessage).toHaveBeenCalledTimes(1)
    expect(mocks.recordSkippedDelivery).toHaveBeenCalledWith(
      { kind: "message", id: "message-1" },
      expect.objectContaining({
        reason:
          "account is restricted: quota exhausted or too many connected Pages",
        logReason: "account_restricted",
      })
    )
    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()
  })
})

const IG_ACCOUNT_USERNAME = "cuenta_resender"

const commentPayload = (value: Record<string, unknown>) => ({
  object: "instagram",
  entry: [{ id: IG_ACCOUNT, time: 1_769_000_000, field: "comments", value }],
})

const comment = (overrides: Record<string, unknown> = {}) => ({
  id: "comment-row",
  tenantId: "tenant-1",
  igCommentId: "ig-comment-1",
  parentIgCommentId: null,
  mediaId: "media-1",
  fromIgId: "9876543210",
  fromUsername: "un_seguidor",
  createdAt: new Date("2026-08-06T00:00:00.000Z"),
  ...overrides,
})

const instagramPage = (overrides: Record<string, unknown> = {}) =>
  page({
    channel: "instagram",
    metaPageId: IG_ACCOUNT,
    username: IG_ACCOUNT_USERNAME,
    ...overrides,
  })

describe("ingesta de comentarios de Instagram", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(true)
    mocks.getTenantEntitlement.mockResolvedValue(unrestricted)
    mocks.getActivePageByMetaPageId.mockResolvedValue(instagramPage())
    mocks.isOwnPublishedComment.mockResolvedValue(false)
    mocks.insertInboundComment.mockResolvedValue({
      comment: comment(),
      inserted: true,
    })
  })

  it("persiste el comentario y prepara su reenvío", async () => {
    const ingested = await ingestInstagramWebhookPayload(
      commentPayload({
        id: "ig-comment-1",
        from: { id: "9876543210", username: "un_seguidor" },
        text: "qué bueno",
        media: { id: "media-1", media_product_type: "FEED" },
      })
    )

    expect(ingested).toHaveLength(1)
    expect(mocks.insertInboundComment).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        connectedPageId: "page-row",
        igCommentId: "ig-comment-1",
        mediaId: "media-1",
        fromIgId: "9876543210",
        text: "qué bueno",
      })
    )

    await ingested[0]!.pushJob()
    expect(mocks.enqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { kind: "comment", id: "comment-row" },
      })
    )
  })

  // Segunda señal anti-bucle: el parser ya filtra por `from.id`, y acá se repite
  // por @handle, que es el dato que el parser no puede consultar porque vive en
  // la base. De este filtro depende que el sistema no se responda a sí mismo.
  it("descarta por @handle un comentario de la propia cuenta que el parser dejó pasar", async () => {
    const ingested = await ingestInstagramWebhookPayload(
      commentPayload({
        id: "ig-comment-1",
        // `from.id` distinto de `entry.id`, así que el parser no lo filtra…
        from: { id: "otro-id", username: IG_ACCOUNT_USERNAME.toUpperCase() },
        text: "nuestra propia respuesta",
        media: { id: "media-1" },
      })
    )

    // …pero el @handle coincide, y la comparación no distingue mayúsculas.
    expect(ingested).toEqual([])
    expect(mocks.insertInboundComment).not.toHaveBeenCalled()
  })

  // Tercera señal anti-bucle, la que existe desde que Resender publica
  // comentarios: las dos anteriores leen el `from` que manda Meta, y esta
  // pregunta si el id es de un comentario nuestro, que es un hecho propio.
  it("descarta la respuesta que publicó Resender aunque el `from` no la delate", async () => {
    mocks.isOwnPublishedComment.mockResolvedValue(true)

    const ingested = await ingestInstagramWebhookPayload(
      commentPayload({
        id: "ig-reply-nuestra",
        // Ni `from.id` ni el @handle coinciden con la cuenta: las dos señales
        // anteriores dejan pasar este payload.
        from: { id: "otro-id", username: "otro_handle" },
        text: "nuestra propia respuesta",
        media: { id: "media-1" },
      })
    )

    expect(ingested).toEqual([])
    expect(mocks.isOwnPublishedComment).toHaveBeenCalledWith({
      connectedPageId: "page-row",
      igCommentId: "ig-reply-nuestra",
    })
    expect(mocks.insertInboundComment).not.toHaveBeenCalled()
  })

  // Las dos señales gratis cortan antes; la que consulta la base solo corre
  // para lo que llegó hasta ahí.
  it("no consulta la base por un comentario que el @handle ya descartó", async () => {
    await ingestInstagramWebhookPayload(
      commentPayload({
        id: "ig-comment-1",
        from: { id: "otro-id", username: IG_ACCOUNT_USERNAME },
        text: "nuestra propia respuesta",
        media: { id: "media-1" },
      })
    )

    expect(mocks.isOwnPublishedComment).not.toHaveBeenCalled()
  })

  it("descarta sin persistir cuando el tenant no tiene suscripción activa", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    await expect(
      ingestInstagramWebhookPayload(
        commentPayload({
          id: "ig-comment-1",
          from: { id: "9876543210", username: "un_seguidor" },
          text: "hola",
          media: { id: "media-1" },
        })
      )
    ).resolves.toEqual([])
    expect(mocks.insertInboundComment).not.toHaveBeenCalled()
  })

  it("no reenvía dos veces el mismo comentario", async () => {
    mocks.insertInboundComment.mockResolvedValue({
      comment: comment(),
      inserted: false,
    })

    await expect(
      ingestInstagramWebhookPayload(
        commentPayload({
          id: "ig-comment-1",
          from: { id: "9876543210", username: "un_seguidor" },
          text: "hola",
          media: { id: "media-1" },
        })
      )
    ).resolves.toEqual([])
  })

  it("registra el salto cuando la cuenta no tiene webhookUrl", async () => {
    mocks.getActivePageByMetaPageId.mockResolvedValue(
      instagramPage({ webhookUrl: null })
    )

    const [ingested] = await ingestInstagramWebhookPayload(
      commentPayload({
        id: "ig-comment-1",
        from: { id: "9876543210", username: "un_seguidor" },
        text: "hola",
        media: { id: "media-1" },
      })
    )
    await ingested!.pushJob()

    expect(mocks.recordSkippedDelivery).toHaveBeenCalledWith(
      { kind: "comment", id: "comment-row" },
      expect.objectContaining({ context: expect.anything() })
    )
  })

  // Un mismo POST de Meta puede traer las dos cosas.
  it("procesa DMs y comentarios que llegan en el mismo payload", async () => {
    mocks.upsertConversation.mockResolvedValue({ id: "conversation-1" })
    mocks.insertInboundMessage.mockResolvedValue({
      message: { id: "message-1", tenantId: "tenant-1" },
      inserted: true,
    })

    const ingested = await ingestInstagramWebhookPayload({
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT,
          time: 1_769_000_000,
          messaging: [
            {
              sender: { id: "igsid-1" },
              timestamp: 1_769_000_000_000,
              message: { mid: "mid-1", text: "un DM" },
            },
          ],
          field: "comments",
          value: {
            id: "ig-comment-1",
            from: { id: "9876543210", username: "un_seguidor" },
            text: "un comentario",
            media: { id: "media-1" },
          },
        },
      ],
    })

    expect(ingested).toHaveLength(2)
    expect(mocks.insertInboundMessage).toHaveBeenCalledTimes(1)
    expect(mocks.insertInboundComment).toHaveBeenCalledTimes(1)
  })
})

// ADR 0010: el permiso por cuenta apaga el canal entero para el tenant
// revocado. No se persiste, no se reenvía, y Meta igual se lleva su 200.
describe("permiso de Instagram por cuenta", () => {
  const expectNotEnabled = (subject: "message" | "comment") =>
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "channel_not_enabled",
        subject,
      })
    )

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(true)
    mocks.getTenantEntitlement.mockResolvedValue(unrestricted)
    mocks.isOwnPublishedComment.mockResolvedValue(false)
    mocks.getActivePageByMetaPageId.mockResolvedValue(instagramPage())
    mocks.upsertConversation.mockResolvedValue({ id: "conversation-1" })
    mocks.insertInboundMessage.mockResolvedValue({
      message: { id: "message-1", tenantId: "tenant-1" },
      inserted: true,
    })
    mocks.insertInboundComment.mockResolvedValue({
      comment: comment(),
      inserted: true,
    })
  })

  it("descarta el DM del tenant sin permiso sin persistir ni reenviar", async () => {
    mocks.resolveInstagramAccess.mockResolvedValue(false)

    await expect(
      ingestInstagramWebhookPayload(
        instagramPayload({ mid: "mid-1", text: "hola" })
      )
    ).resolves.toEqual([])
    expect(mocks.insertInboundMessage).not.toHaveBeenCalled()
    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()
    expectNotEnabled("message")
  })

  it("descarta el comentario del tenant sin permiso sin persistir ni reenviar", async () => {
    mocks.resolveInstagramAccess.mockResolvedValue(false)

    await expect(
      ingestInstagramWebhookPayload(
        commentPayload({
          id: "ig-comment-1",
          from: { id: "9876543210", username: "un_seguidor" },
          text: "hola",
          media: { id: "media-1" },
        })
      )
    ).resolves.toEqual([])
    expect(mocks.insertInboundComment).not.toHaveBeenCalled()
    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()
    expectNotEnabled("comment")
  })

  // El permiso es de **un** canal: el Facebook del mismo tenant sigue andando.
  it("no toca la ingesta de Messenger aunque el tenant no tenga el permiso", async () => {
    mocks.resolveInstagramAccess.mockResolvedValue(false)
    mocks.getTenantEntitlement.mockResolvedValue(unrestricted)
    mocks.getActivePageByMetaPageId.mockResolvedValue(page())

    const [ingested] = await ingestMetaWebhookPayload(messengerPayload())
    await ingested!.pushJob()

    expect(mocks.insertInboundMessage).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueDelivery).toHaveBeenCalledTimes(1)
    // Ni siquiera se pregunta: Messenger no tiene bandera que consultar.
    expect(mocks.resolveInstagramAccess).not.toHaveBeenCalled()
  })

  // La lectura es viva contra la base, así que un sobre con varios eventos de
  // la misma cuenta no puede pagar una consulta por evento.
  it("resuelve el permiso una sola vez por tenant dentro del lote", async () => {
    await ingestInstagramWebhookPayload({
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT,
          messaging: [
            {
              sender: { id: "igsid-1" },
              timestamp: 1_769_000_000_000,
              message: { mid: "mid-1", text: "hola" },
            },
            {
              sender: { id: "igsid-2" },
              timestamp: 1_769_000_000_001,
              message: { mid: "mid-2", text: "otra" },
            },
          ],
        },
      ],
    })

    expect(mocks.insertInboundMessage).toHaveBeenCalledTimes(2)
    expect(mocks.resolveInstagramAccess).toHaveBeenCalledTimes(1)
  })
})

// El bloque que hace cumplir la regla del módulo: **ningún camino puede
// terminar en silencio**. No son tests de logging — son el test de que no se
// agregó un `continue` sin motivo.
//
// Las aserciones son de tres campos (`action`, `outcome`, `reason`) y nunca del
// registro completo: agregar un `durationMs` más adelante no tiene que romper
// veinte tests.
describe("ningún evento se descarta en silencio", () => {
  const terminalLines = () =>
    mocks.log.mock.calls
      .map(([fields]) => fields)
      .filter((fields) => fields.action === "inbound_ingest")

  const expectDrop = (reason: string) =>
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbound_ingest",
        outcome: "dropped",
        reason,
      })
    )

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(true)
    mocks.getTenantEntitlement.mockResolvedValue(unrestricted)
    mocks.isOwnPublishedComment.mockResolvedValue(false)
    mocks.getActivePageByMetaPageId.mockResolvedValue(instagramPage())
    mocks.upsertConversation.mockResolvedValue({
      id: "conversation-1",
      contactId: "igsid-1",
    })
    mocks.insertInboundMessage.mockResolvedValue({
      message: { id: "message-1", tenantId: "tenant-1" },
      inserted: true,
    })
    mocks.insertInboundComment.mockResolvedValue({
      comment: comment(),
      inserted: true,
    })
  })

  // **La póliza de seguro.** Si alguien agrega un descarte nuevo y se olvida de
  // la línea, este test falla sin que nadie tenga que acordarse de sumarle un
  // caso: cada evento que entra tiene que producir exactamente una línea
  // terminal, sea `ok`, `duplicate` o `dropped`.
  const scenarios: Array<[string, () => void]> = [
    [
      "la cuenta no resuelve",
      () => mocks.getActivePageByMetaPageId.mockResolvedValue(null),
    ],
    [
      "no hay suscripción activa",
      () => mocks.hasActiveSubscription.mockResolvedValue(false),
    ],
    [
      "el tenant no tiene el permiso de Instagram",
      () => mocks.resolveInstagramAccess.mockResolvedValue(false),
    ],
    [
      "es un duplicado",
      () => {
        mocks.insertInboundMessage.mockResolvedValue({
          message: { id: "message-1", tenantId: "tenant-1" },
          inserted: false,
        })
        mocks.insertInboundComment.mockResolvedValue({
          comment: comment(),
          inserted: false,
        })
      },
    ],
    ["entra normalmente", () => {}],
  ]

  it.each(scenarios)(
    "un DM produce exactamente una línea terminal cuando %s",
    async (_label, arrange) => {
      arrange()
      await ingestInstagramWebhookPayload(
        instagramPayload({ mid: "mid-1", text: "hola" })
      )
      expect(terminalLines()).toHaveLength(1)
    }
  )

  it.each(scenarios)(
    "un comentario produce exactamente una línea terminal cuando %s",
    async (_label, arrange) => {
      arrange()
      await ingestInstagramWebhookPayload(
        commentPayload({
          id: "ig-comment-1",
          from: { id: "9876543210", username: "un_seguidor" },
          text: "hola",
          media: { id: "media-1" },
        })
      )
      expect(terminalLines()).toHaveLength(1)
    }
  )

  it("nombra el canal cuando la cuenta no resuelve", async () => {
    // Sin el canal, «cuenta no encontrada» no se puede investigar: desde la
    // 0013 el mismo id existe en los dos y hay que saber en cuál se buscó.
    mocks.getActivePageByMetaPageId.mockResolvedValue(null)
    await ingestInstagramWebhookPayload(
      instagramPayload({ mid: "mid-1", text: "hola" })
    )

    expectDrop("account_not_connected")
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "instagram", accountId: IG_ACCOUNT })
    )
  })

  it("distingue las dos señales anti-bucle de la ingesta", async () => {
    // Motivos separados a propósito: son señales independientes y si una deja
    // de disparar hay que ver cuál quedó sosteniendo el filtro sola.
    await ingestInstagramWebhookPayload(
      commentPayload({
        id: "ig-comment-1",
        from: { id: "otro-id", username: IG_ACCOUNT_USERNAME.toUpperCase() },
        text: "mi propia respuesta",
        media: { id: "media-1" },
      })
    )
    expectDrop("self_authored_comment")

    mocks.log.mockClear()
    mocks.isOwnPublishedComment.mockResolvedValue(true)
    await ingestInstagramWebhookPayload(
      commentPayload({
        id: "ig-comment-1",
        from: { id: "9876543210", username: "un_seguidor" },
        text: "mi propia respuesta",
        media: { id: "media-1" },
      })
    )
    expectDrop("own_published_comment")
  })

  it("cuenta el texto pero no lo escribe", async () => {
    // El tipo ya no tiene campo para el texto; este test atrapa a quien lo
    // ensanche más adelante.
    await ingestInstagramWebhookPayload(
      instagramPayload({ mid: "mid-1", text: "mi tarjeta es 4111 1111 1111" })
    )

    const logged = JSON.stringify(mocks.log.mock.calls)
    expect(logged).not.toContain("4111")
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "inbound_ingest", textLength: 28 })
    )
  })

  it("ata el sobre con sus eventos por requestId", async () => {
    await ingestInstagramWebhookPayload(
      instagramPayload({ mid: "mid-1", text: "hola" })
    )

    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST_ID })
    )
  })
})

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

const PHONE_NUMBER_ID = "106540352242922"
const BUSINESS_PHONE = "15550783881"
const USER_PHONE = "16505551234"
const WAMID = "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA="

const whatsappPage = (overrides: Record<string, unknown> = {}) =>
  page({ channel: "whatsapp", metaPageId: PHONE_NUMBER_ID, ...overrides })

const whatsappChange = (field: string, value: Record<string, unknown>) => ({
  value: {
    messaging_product: "whatsapp",
    metadata: {
      display_phone_number: BUSINESS_PHONE,
      phone_number_id: PHONE_NUMBER_ID,
    },
    ...value,
  },
  field,
})

const whatsappPayload = (...changes: Array<Record<string, unknown>>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "102290129340398", changes }],
})

const liveText = (overrides: Record<string, unknown> = {}) =>
  whatsappChange("messages", {
    contacts: [{ profile: { name: "Sheena" }, wa_id: USER_PHONE }],
    messages: [
      {
        from: USER_PHONE,
        id: WAMID,
        timestamp: "1749416383",
        type: "text",
        text: { body: "hola" },
        ...overrides,
      },
    ],
  })

const arrangeWhatsapp = () => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.hasActiveSubscription.mockResolvedValue(true)
  mocks.resolveWhatsappAccess.mockResolvedValue(true)
  mocks.getTenantEntitlement.mockResolvedValue(unrestricted)
  mocks.getActivePageByMetaPageId.mockResolvedValue(whatsappPage())
  mocks.upsertConversation.mockResolvedValue({
    id: "conversation-1",
    contactId: USER_PHONE,
  })
  mocks.insertInboundMessage.mockResolvedValue({
    message: { id: "message-1", tenantId: "tenant-1" },
    inserted: true,
  })
  mocks.insertCoexistenceMessage.mockResolvedValue({
    message: { id: "message-2", tenantId: "tenant-1" },
    inserted: true,
  })
  mocks.updateDeliveryStatus.mockResolvedValue(true)
}

describe("ingesta de WhatsApp", () => {
  beforeEach(arrangeWhatsapp)

  // El canal lo impone el webhook, nunca el payload: el `phone_number_id` es
  // lo que `connected_pages.meta_page_id` guarda en este canal.
  it("resuelve la cuenta por phone_number_id contra el canal whatsapp", async () => {
    await ingestWhatsappWebhookPayload(whatsappPayload(liveText()))

    expect(mocks.getActivePageByMetaPageId).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      "whatsapp"
    )
  })

  // El mismo orden que Messenger e Instagram, con la bandera de WhatsApp:
  // cuenta → suscripción → permiso de canal → persistir.
  it("aplica los tres gates antes de persistir", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)
    await expect(
      ingestWhatsappWebhookPayload(whatsappPayload(liveText()))
    ).resolves.toEqual([])

    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveWhatsappAccess.mockResolvedValue(false)
    await expect(
      ingestWhatsappWebhookPayload(whatsappPayload(liveText()))
    ).resolves.toEqual([])

    expect(mocks.insertInboundMessage).not.toHaveBeenCalled()
    expect(mocks.incrementUsage).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbound_ingest",
        outcome: "dropped",
        reason: "channel_not_enabled",
        channel: "whatsapp",
      })
    )
  })

  // La regla de la ventana de 24 h vive en `opensCustomerServiceWindow`: acá
  // solo se comprueba que se le pasa el mensaje, no que se recalcula al lado.
  it("le pasa el descriptor del mensaje al upsert de la conversación", async () => {
    await ingestWhatsappWebhookPayload(whatsappPayload(liveText()))

    expect(mocks.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: USER_PHONE,
        message: {
          direction: "inbound",
          historical: false,
          origin: "customer",
        },
      })
    )
  })

  it("persiste el entrante vivo con sus columnas de la 0017 y lo reenvía", async () => {
    const ingested = await ingestWhatsappWebhookPayload(
      whatsappPayload(liveText())
    )

    expect(mocks.insertInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: USER_PHONE,
        metaMessageId: WAMID,
        origin: "customer",
        historical: false,
        attachmentStatus: null,
        replyToMetaMessageId: null,
      })
    )
    expect(mocks.incrementUsage).toHaveBeenCalledWith(
      "tenant-1",
      unrestricted.periodStart
    )

    await ingested[0]!.pushJob()
    expect(mocks.enqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ subject: { kind: "message", id: "message-1" } })
    )
  })

  it("no reenvía dos veces el mismo wamid", async () => {
    mocks.insertInboundMessage.mockResolvedValue({
      message: { id: "message-1", tenantId: "tenant-1" },
      inserted: false,
    })

    await expect(
      ingestWhatsappWebhookPayload(whatsappPayload(liveText()))
    ).resolves.toEqual([])
    expect(mocks.queueSend).not.toHaveBeenCalled()
  })
})

// El binario no se baja acá: a Meta hay que contestarle el 200 antes, y la URL
// de descarga dura cinco minutos.
describe("media entrante de WhatsApp", () => {
  beforeEach(arrangeWhatsapp)

  it("encola la descarga cuando hay id de asset", async () => {
    await ingestWhatsappWebhookPayload(
      whatsappPayload(
        liveText({
          type: "image",
          text: undefined,
          image: { id: "622684793477189", mime_type: "image/jpeg" },
        })
      )
    )

    expect(mocks.insertInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentStatus: "pending" })
    )
    expect(mocks.queueSend).toHaveBeenCalledWith({
      type: "media_download",
      messageId: "message-1",
      providerMediaId: "622684793477189",
    })
  })

  // `unavailable` es «Meta nunca ofreció el binario»: encolarle una descarga
  // sería reintentar para siempre algo que no existe.
  it("marca unavailable sin encolar nada cuando no hay id de asset", async () => {
    await ingestWhatsappWebhookPayload(
      whatsappPayload(
        liveText({
          type: "image",
          text: undefined,
          image: { mime_type: "image/jpeg" },
        })
      )
    )

    expect(mocks.insertInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentStatus: "unavailable" })
    )
    expect(mocks.queueSend).not.toHaveBeenCalled()
  })

  // La fila queda en `pending`, que es lo que busca el índice parcial de la
  // 0017: recuperable, pero nunca en silencio.
  it("registra el fallo al encolar sin romper la ingesta", async () => {
    mocks.queueSend.mockRejectedValue(new Error("queue down"))

    const ingested = await ingestWhatsappWebhookPayload(
      whatsappPayload(
        liveText({
          type: "image",
          text: undefined,
          image: { id: "622684793477189", mime_type: "image/jpeg" },
        })
      )
    )

    expect(ingested).toHaveLength(1)
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbound_ingest",
        outcome: "failed",
        reason: "internal_error",
      })
    )
  })
})

// La única excepción declarada a «todos los canales se miden» (ADR 0011).
describe("historial y echoes de Coexistence", () => {
  const historyPayload = (status = "READ") =>
    whatsappPayload(
      whatsappChange("history", {
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 100 },
            threads: [
              {
                id: USER_PHONE,
                messages: [
                  {
                    from: BUSINESS_PHONE,
                    id: "wamid.historico",
                    timestamp: "1739230955",
                    type: "text",
                    text: { body: "de hace medio año" },
                    history_context: { status },
                  },
                ],
              },
            ],
          },
        ],
      })
    )

  const echoPayload = () =>
    whatsappPayload(
      whatsappChange("smb_message_echoes", {
        message_echoes: [
          {
            from: BUSINESS_PHONE,
            to: USER_PHONE,
            id: "wamid.eco",
            timestamp: "1739321024",
            type: "text",
            text: { body: "escrito desde el móvil" },
          },
        ],
      })
    )

  beforeEach(arrangeWhatsapp)

  it("persiste el historial pero no lo cuenta ni lo reenvía", async () => {
    await expect(
      ingestWhatsappWebhookPayload(historyPayload())
    ).resolves.toEqual([])

    // Saliente con wamid: deduplica contra el índice de la 0017 §7.
    expect(mocks.insertCoexistenceMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metaMessageId: "wamid.historico",
        origin: "history",
        historical: true,
        deliveryStatus: "read",
      })
    )
    // Ni cuota, ni entrega, ni salto registrado: el histórico no llega nunca
    // al webhook del tenant, así que tampoco hay nada que anotar como omitido.
    expect(mocks.incrementUsage).not.toHaveBeenCalled()
    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()
    expect(mocks.recordSkippedDelivery).not.toHaveBeenCalled()
  })

  it("no abre la ventana de 24 h con un mensaje del historial", async () => {
    await ingestWhatsappWebhookPayload(historyPayload())

    expect(mocks.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ historical: true }),
      })
    )
  })

  // El eco es tráfico vivo: se reenvía y se cobra.
  it("persiste el echo como saliente, lo cuenta y lo reenvía", async () => {
    const ingested = await ingestWhatsappWebhookPayload(echoPayload())

    expect(mocks.insertCoexistenceMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: USER_PHONE,
        metaMessageId: "wamid.eco",
        origin: "business_app",
        historical: false,
      })
    )
    expect(mocks.incrementUsage).toHaveBeenCalledWith(
      "tenant-1",
      unrestricted.periodStart
    )

    await ingested[0]!.pushJob()
    expect(mocks.enqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ subject: { kind: "message", id: "message-2" } })
    )
  })

  // Un echo con la cuenta restringida se comporta como cualquier otro entrante
  // vivo (ADR 0003): se persiste, se cuenta y deja de reenviarse.
  it("deja de reenviar el echo con el tenant restringido", async () => {
    mocks.getTenantEntitlement.mockResolvedValue(restricted)

    const [ingested] = await ingestWhatsappWebhookPayload(echoPayload())
    await ingested!.pushJob()

    expect(mocks.recordSkippedDelivery).toHaveBeenCalledWith(
      { kind: "message", id: "message-2" },
      expect.objectContaining({ logReason: "account_restricted" })
    )
  })
})

describe("acuses de entrega de WhatsApp", () => {
  const statusPayload = (status: string) =>
    whatsappPayload(
      whatsappChange("messages", {
        statuses: [
          {
            id: WAMID,
            status,
            timestamp: "1749416400",
            recipient_id: USER_PHONE,
          },
        ],
      })
    )

  beforeEach(arrangeWhatsapp)

  it("mueve delivery_status con un solo update guardado", async () => {
    await expect(
      ingestWhatsappWebhookPayload(statusPayload("read"))
    ).resolves.toEqual([])

    expect(mocks.updateDeliveryStatus).toHaveBeenCalledWith({
      connectedPageId: "page-row",
      metaMessageId: WAMID,
      deliveryStatus: "read",
    })
    // Un acuse no crea fila ni entrega nada.
    expect(mocks.insertInboundMessage).not.toHaveBeenCalled()
    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()
  })

  // El callback atrasado pierde la guarda del UPDATE. No es dato que mostrar,
  // es una inconsistencia de Meta: se descarta, pero con métrica.
  it("registra el callback que pierde la guarda en vez de tragárselo", async () => {
    mocks.updateDeliveryStatus.mockResolvedValue(false)

    await ingestWhatsappWebhookPayload(statusPayload("sent"))

    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inbound_ingest",
        outcome: "duplicate",
        reason: "already_ingested",
        providerId: WAMID,
      })
    )
  })

  it("no toca la base con la cuenta sin permiso de canal", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)

    await ingestWhatsappWebhookPayload(statusPayload("delivered"))

    expect(mocks.updateDeliveryStatus).not.toHaveBeenCalled()
  })

  // Los mensajes se procesan antes que los acuses: si el mismo POST trae los
  // dos, el UPDATE encuentra la fila que el insert acaba de escribir.
  it("procesa los mensajes antes que sus acuses", async () => {
    const order: string[] = []
    mocks.insertInboundMessage.mockImplementation(async () => {
      order.push("insert")
      return {
        message: { id: "message-1", tenantId: "tenant-1" },
        inserted: true,
      }
    })
    mocks.updateDeliveryStatus.mockImplementation(async () => {
      order.push("status")
      return true
    })

    await ingestWhatsappWebhookPayload(
      whatsappPayload(
        liveText(),
        whatsappChange("messages", {
          statuses: [
            { id: WAMID, status: "delivered", timestamp: "1749416400" },
          ],
        })
      )
    )

    expect(order).toEqual(["insert", "status"])
  })
})

describe("campos de WhatsApp que ningún parser modela", () => {
  beforeEach(arrangeWhatsapp)

  it("los registra en vez de tragárselos", async () => {
    await ingestWhatsappWebhookPayload(
      whatsappPayload(whatsappChange("account_update", { event: "VERIFIED" }))
    )

    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "webhook_receive",
        outcome: "dropped",
        channel: "whatsapp",
        fields: ["account_update"],
      })
    )
  })
})
