import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getSql: () => sqlMock,
}))

import { buildInboundPushPayload } from "./external-push"

const payload = {
  type: "message" as const,
  tenant: { id: "tenant-1" },
  page: {
    id: "page-row",
    channel: "messenger" as const,
    metaPageId: "meta-page",
    name: "Main Page",
    username: null,
  },
  conversation: { id: "conversation-1", contactId: "psid-1" },
  message: {
    id: "message-1",
    metaMessageId: "mid-1",
    eventType: "message" as const,
    postbackPayload: null,
    direction: "inbound" as const,
    status: "received" as const,
    text: "hola",
    attachment: null,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
}

describe("inbound push payload", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    sqlMock.mockResolvedValue([])
    vi.unstubAllGlobals()
  })

  it("includes tenant, page, conversation and message context", () => {
    const result = buildInboundPushPayload({
      page: {
        id: "page-row",
        tenantId: "tenant-1",
        channel: "messenger",
        metaPageId: "meta-page",
        name: "Main Page",
        username: null,
        status: "active",
        tokenStatus: "valid",
        tokenError: null,
        tokenErrorAt: null,
        tokenExpiresAt: null,
        webhookUrl: "https://example.com/hook",
        wabaId: null,
        whatsappPhoneE164: null,
        onboardingMode: null,
        coexistenceStatus: null,
        historySyncStatus: null,
        whatsappPinGenerated: false,
        hasSigningSecret: false,
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
        disconnectedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      conversation: {
        id: "conversation-1",
        tenantId: "tenant-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        contactName: null,
        lastMessageAt: new Date("2026-01-02T00:00:00.000Z"),
        lastInboundAt: null,
      },
      message: {
        id: "message-1",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        direction: "inbound",
        status: "received",
        text: "hola",
        metaMessageId: "mid-1",
        idempotencyKey: null,
        instagramSourceCommentId: null,
        attachmentType: null,
        attachmentUrl: null,
        attachmentMeta: null,
        error: null,
        providerResponse: null,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      eventType: "message",
      postbackPayload: null,
    })

    expect(result).toEqual(payload)
  })

  // Fabrica los tres argumentos que no cambian entre casos; cada test pisa
  // solo el message.
  const buildWith = (
    message: Partial<Parameters<typeof buildInboundPushPayload>[0]["message"]>
  ) =>
    buildInboundPushPayload({
      page: {
        id: "page-row",
        tenantId: "tenant-1",
        channel: "messenger",
        metaPageId: "meta-page",
        name: "Main Page",
        username: null,
        status: "active",
        tokenStatus: "valid",
        tokenError: null,
        tokenErrorAt: null,
        tokenExpiresAt: null,
        webhookUrl: "https://example.com/hook",
        wabaId: null,
        whatsappPhoneE164: null,
        onboardingMode: null,
        coexistenceStatus: null,
        historySyncStatus: null,
        whatsappPinGenerated: false,
        hasSigningSecret: false,
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
        disconnectedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      conversation: {
        id: "conversation-1",
        tenantId: "tenant-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        contactName: null,
        lastMessageAt: new Date("2026-01-02T00:00:00.000Z"),
        lastInboundAt: null,
      },
      message: {
        id: "message-1",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        connectedPageId: "page-row",
        contactId: "psid-1",
        direction: "inbound",
        status: "received",
        text: "hola",
        metaMessageId: "mid-1",
        idempotencyKey: null,
        instagramSourceCommentId: null,
        attachmentType: null,
        attachmentUrl: null,
        attachmentMeta: null,
        error: null,
        providerResponse: null,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        ...message,
      },
      eventType: "message",
      postbackPayload: null,
    })

  // El split inverso del merge de `insertInboundMessage`: `title` sale del
  // jsonb hacia su campo propio y el resto queda ANIDADO en `details` — nada
  // de claves sueltas como `stickerId` o `booking` colgando de `attachment`.
  it("deriva el adjunto de la fila con los detalles anidados", () => {
    const result = buildWith({
      text: "",
      attachmentType: "reel",
      attachmentUrl: "https://cdn.meta.test/reel.mp4",
      attachmentMeta: { title: "Un reel", reelVideoId: "998877" },
    })

    expect(result.message.text).toBe("")
    expect(result.message.attachment).toEqual({
      type: "reel",
      url: "https://cdn.meta.test/reel.mp4",
      title: "Un reel",
      details: { reelVideoId: "998877" },
    })
  })

  it("deja details vacio cuando el meta guardado era vacio o null", () => {
    expect(
      buildWith({
        attachmentType: "image",
        attachmentUrl: "https://cdn.meta.test/foto.jpg",
        attachmentMeta: {},
      }).message.attachment
    ).toEqual({
      type: "image",
      url: "https://cdn.meta.test/foto.jpg",
      title: null,
      details: {},
    })

    expect(
      buildWith({
        attachmentType: "image",
        attachmentUrl: "https://cdn.meta.test/foto.jpg",
        attachmentMeta: null,
      }).message.attachment
    ).toEqual({
      type: "image",
      url: "https://cdn.meta.test/foto.jpg",
      title: null,
      details: {},
    })
  })

  it("manda attachment null explicito cuando no hubo adjunto", () => {
    const result = buildWith({})
    expect(result.message.attachment).toBeNull()
    expect("attachment" in result.message).toBe(true)
  })

  // **El sobre de Messenger no se movió.** WhatsApp agrega seis claves al
  // contrato y ninguna aparece acá: hay clientes consumiendo este JSON hoy, y
  // un `phoneNumberId: null` en un mensaje de Facebook no informa nada. La
  // comparación es sobre el texto serializado y no con `toEqual` a propósito:
  // `toEqual` ignora las claves con valor `undefined` y dejaría pasar
  // justamente el error que este test existe para atrapar.
  it("deja el sobre de Messenger byte por byte como estaba", () => {
    expect(JSON.stringify(buildWith({}))).toBe(
      '{"type":"message","tenant":{"id":"tenant-1"},' +
        '"page":{"id":"page-row","channel":"messenger","metaPageId":"meta-page",' +
        '"name":"Main Page","username":null},' +
        '"conversation":{"id":"conversation-1","contactId":"psid-1"},' +
        '"message":{"id":"message-1","metaMessageId":"mid-1","eventType":"message",' +
        '"postbackPayload":null,"direction":"inbound","status":"received",' +
        '"text":"hola","attachment":null,"createdAt":"2026-01-02T00:00:00.000Z"}}'
    )
  })
})

// ---------------------------------------------------------------------------
// WhatsApp: los campos aditivos y la URL de media.
// ---------------------------------------------------------------------------

const whatsappPage = {
  id: "page-row",
  tenantId: "tenant-1",
  channel: "whatsapp" as const,
  metaPageId: "106540352242922",
  name: "Atención",
  username: null,
  status: "active" as const,
  tokenStatus: "valid" as const,
  tokenError: null,
  tokenErrorAt: null,
  tokenExpiresAt: null,
  webhookUrl: "https://example.com/hook",
  wabaId: "102290129340398",
  whatsappPhoneE164: "+15550783881",
  onboardingMode: "coexistence" as const,
  coexistenceStatus: null,
  historySyncStatus: null,
  whatsappPinGenerated: false,
  hasSigningSecret: false,
  connectedAt: new Date("2026-01-01T00:00:00.000Z"),
  disconnectedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
}

const buildWhatsapp = (
  message: Partial<
    Parameters<typeof buildInboundPushPayload>[0]["message"]
  > = {},
  now = new Date("2026-01-03T00:00:00.000Z")
) =>
  buildInboundPushPayload({
    page: whatsappPage,
    conversation: {
      id: "conversation-1",
      tenantId: "tenant-1",
      connectedPageId: "page-row",
      contactId: "16505551234",
      contactName: null,
      lastMessageAt: new Date("2026-01-02T00:00:00.000Z"),
      lastInboundAt: new Date("2026-01-02T00:00:00.000Z"),
    },
    message: {
      id: "message-1",
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      connectedPageId: "page-row",
      contactId: "16505551234",
      direction: "inbound",
      status: "received",
      text: "Factura",
      metaMessageId: "wamid.1",
      idempotencyKey: null,
      instagramSourceCommentId: null,
      attachmentType: null,
      attachmentUrl: null,
      attachmentMeta: null,
      origin: "customer",
      historical: false,
      deliveryStatus: null,
      attachmentStatus: null,
      attachmentR2Key: null,
      replyToMetaMessageId: null,
      error: null,
      providerResponse: null,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      ...message,
    },
    eventType: "message",
    postbackPayload: null,
    now,
  })

describe("sobre de WhatsApp", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://resender.test")
  })

  it("agrega la identidad del número y la procedencia del mensaje", () => {
    const result = buildWhatsapp()

    expect(result.page).toEqual({
      id: "page-row",
      channel: "whatsapp",
      metaPageId: "106540352242922",
      name: "Atención",
      username: null,
      // El mismo valor que `metaPageId`, con el nombre que el cliente ve en el
      // panel de Meta.
      phoneNumberId: "106540352242922",
      wabaId: "102290129340398",
      onboardingMode: "coexistence",
    })
    expect(result.message).toMatchObject({
      origin: "customer",
      historical: false,
      replyToProviderMessageId: null,
      deliveryStatus: null,
    })
  })

  // El eco de la Business App es saliente y el sobre no se bifurca por eso.
  it("refleja la dirección y el origen del echo en vez de escribirlos a mano", () => {
    const result = buildWhatsapp({
      direction: "outbound",
      status: "sent",
      origin: "business_app",
      metaMessageId: "wamid.eco",
    })

    expect(result.message.direction).toBe("outbound")
    expect(result.message.status).toBe("sent")
    expect(result.message.origin).toBe("business_app")
  })

  it("apunta la URL del adjunto a nuestra ruta de media y no a la de Meta", () => {
    const result = buildWhatsapp({
      text: "",
      attachmentType: "file",
      attachmentMeta: { title: "factura.pdf", mimeType: "application/pdf" },
      attachmentStatus: "available",
    })

    expect(result.message.attachment).toEqual({
      type: "file",
      url: "https://resender.test/api/meta/whatsapp/media/message-1",
      title: "factura.pdf",
      details: { mimeType: "application/pdf", status: "available" },
    })
  })

  // Los dos casos en los que el archivo no va a existir nunca más: la URL va
  // null para que el cliente no reintente contra un 404 eterno.
  it("deja la URL en null cuando el binario no existe ni va a existir", () => {
    const unavailable = buildWhatsapp({
      attachmentType: "image",
      attachmentMeta: {},
      attachmentStatus: "unavailable",
    })
    expect(unavailable.message.attachment).toMatchObject({
      url: null,
      details: { status: "unavailable" },
    })

    // `deleted` no está guardado: se deriva de la edad de la fila contra los
    // 180 días de retención, que es el mismo reloj que usa la lifecycle rule
    // del bucket.
    const expired = buildWhatsapp(
      {
        attachmentType: "image",
        attachmentMeta: {},
        attachmentStatus: "available",
      },
      new Date("2026-07-15T00:00:00.000Z")
    )
    expect(expired.message.attachment).toMatchObject({
      url: null,
      details: { status: "deleted" },
    })
  })

  // Un adjunto sin binario —ubicación, reacción, respuesta interactiva— no
  // gana un `status: null` que el consumidor tendría que interpretar.
  it("no inventa estado para un adjunto que no tiene binario", () => {
    const result = buildWhatsapp({
      attachmentType: "location",
      attachmentMeta: { latitude: -34.6, longitude: -58.4 },
      attachmentStatus: null,
    })

    expect(result.message.attachment).toEqual({
      type: "location",
      url: null,
      title: null,
      details: { latitude: -34.6, longitude: -58.4 },
    })
  })
})
