import { describe, expect, it, vi } from "vitest"

import type {
  CommentRecord,
  MessageRecord,
  PageRecord,
  SqlRepository,
  SubscriptionRecord,
  UserRecord,
} from "../infrastructure/db/repository"
import { encryptSecret, hmacHex } from "../infrastructure/crypto/secrets"
import type { MetaClient } from "../infrastructure/meta/client"
import type { InstagramClient } from "../infrastructure/meta/instagram-client"
import { createApp } from "../http/app"
import { ApiService } from "./service"

const CREATED_AT = new Date("2026-07-29T18:00:00.000Z")
const KEY = "0000000000000000000000000000000000000000000000000000000000000000"
const IG_ACCOUNT = "17841400000000000"
const PAGE_ID = "3b1f4e0a-8d61-4c92-9a77-1c53b0e2a740"
const COMMENT_ID = "1f0c9b2e-6d2a-4a5f-9f43-2f9a4b6d0c11"
const TENANT = "6b402566-9e1d-4739-bb61-81ac615a5469"

describe("Instagram webhook signature", () => {
  // El App Secret de Instagram es distinto del de Facebook. Firmar un webhook de
  // Instagram con el secreto de Facebook es el error de configuración más común
  // de esta integración, y es la razón por la que Instagram tiene ruta propia.
  it("accepts the Instagram secret and rejects the Facebook one", async () => {
    const service = instagramService({})
    const raw = JSON.stringify({ entry: [] })

    await expect(
      service.ingestInstagramWebhook(
        raw,
        `sha256=${await hmacHex("ig-secret", raw)}`
      )
    ).resolves.toEqual({ accepted: 0 })

    await expect(
      service.ingestInstagramWebhook(
        raw,
        `sha256=${await hmacHex("fb-secret", raw)}`
      )
    ).rejects.toMatchObject({ code: "invalid_signature" })

    await expect(
      service.ingestInstagramWebhook(raw, null)
    ).rejects.toMatchObject({ code: "invalid_signature" })
  })
})

describe("Instagram inbound ingestion", () => {
  it("resolves the account against the Instagram channel, never Messenger", async () => {
    const getActivePageByProviderId = vi.fn(async () => page())
    const service = instagramService({
      getActivePageByProviderId,
      ingestInbound: async () => inboundResult(),
    })

    await ingest(service, directMessagePayload())

    expect(getActivePageByProviderId).toHaveBeenCalledWith(
      IG_ACCOUNT,
      "instagram"
    )
  })

  // Instagram está fuera de cuota: sin período no hay contador que incrementar,
  // y la restricción por consumo de Messenger tampoco lo frena.
  it("ingests a DM without a billing period and without blocking delivery", async () => {
    const ingestInbound = vi.fn(async () => inboundResult())
    const getUsage = vi.fn(async () => 0)
    const service = instagramService({ ingestInbound, getUsage })

    await expect(ingest(service, directMessagePayload())).resolves.toEqual({
      accepted: 1,
    })
    expect(ingestInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: null,
        deliveryEnabled: true,
        deliveryBlockedReason: null,
      })
    )
    // Sin contador que incrementar, el entitlement ni se resuelve.
    expect(getUsage).not.toHaveBeenCalled()
  })

  it("discards events for a tenant without product access, before persisting", async () => {
    const ingestInbound = vi.fn(async () => inboundResult())
    const service = instagramService({
      ingestInbound,
      getSubscription: async () => null,
    })

    await expect(ingest(service, directMessagePayload())).resolves.toEqual({
      accepted: 0,
    })
    expect(ingestInbound).not.toHaveBeenCalled()
  })

  // Un mismo POST de Meta puede traer las dos cosas en ramas distintas del
  // mismo `entry`.
  it("processes a DM and a comment arriving in the same payload", async () => {
    const ingestInbound = vi.fn(async () => inboundResult())
    const ingestInboundComment = vi.fn(async () => commentResult())
    const service = instagramService({ ingestInbound, ingestInboundComment })

    await expect(
      ingest(service, {
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
    ).resolves.toEqual({ accepted: 2 })
    expect(ingestInbound).toHaveBeenCalledTimes(1)
    expect(ingestInboundComment).toHaveBeenCalledTimes(1)
  })
})

describe("the three anti-loop signals on comments", () => {
  // Segunda señal: el @handle, que el parser no puede consultar porque vive en
  // la base.
  it("drops a comment whose author handle matches the account, ignoring case", async () => {
    const ingestInboundComment = vi.fn(async () => commentResult())
    const service = instagramService({ ingestInboundComment })

    await expect(
      ingest(
        service,
        commentPayload({
          // `from.id` distinto de `entry.id`, así que el parser lo deja pasar…
          from: { id: "otro-id", username: "CUENTA_RESENDER" },
        })
      )
    ).resolves.toEqual({ accepted: 0 })
    expect(ingestInboundComment).not.toHaveBeenCalled()
  })

  // Tercera señal, la única que no depende del `from` que manda Meta.
  it("drops a comment Resender itself published", async () => {
    const ingestInboundComment = vi.fn(async () => commentResult())
    const isOwnPublishedComment = vi.fn(async () => true)
    const service = instagramService({
      ingestInboundComment,
      isOwnPublishedComment,
    })

    await expect(ingest(service, commentPayload())).resolves.toEqual({
      accepted: 0,
    })
    expect(isOwnPublishedComment).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      providerCommentId: "ig-comment-1",
    })
    expect(ingestInboundComment).not.toHaveBeenCalled()
  })

  // Las dos señales gratis cortan antes; la que consulta la base solo corre
  // para lo que llegó hasta ahí.
  it("does not hit the database for a comment the handle already dropped", async () => {
    const isOwnPublishedComment = vi.fn(async () => false)
    const service = instagramService({ isOwnPublishedComment })

    await ingest(
      service,
      commentPayload({ from: { id: "otro-id", username: "cuenta_resender" } })
    )

    expect(isOwnPublishedComment).not.toHaveBeenCalled()
  })
})

describe("public replies to comments", () => {
  it("publishes the reply and persists it hanging off the source comment", async () => {
    const insertOutboundComment = vi.fn(async () => outboundComment())
    const replyToComment = vi.fn(async () => ({
      ok: true as const,
      commentId: "ig-reply-1",
      response: { id: "ig-reply-1" },
    }))
    const service = instagramService(
      { insertOutboundComment },
      { replyToComment }
    )

    const result = await service.replyToComment({
      tenantId: TENANT,
      commentId: COMMENT_ID,
      idempotencyKey: "idem-1",
      reply: { text: "gracias!" },
    })

    expect(result.created).toBe(true)
    expect(replyToComment).toHaveBeenCalledWith(
      expect.objectContaining({ providerCommentId: "ig-comment-1" })
    )
    expect(insertOutboundComment).toHaveBeenCalledWith(
      expect.objectContaining({
        parentCommentId: "ig-comment-1",
        providerCommentId: "ig-reply-1",
        mediaId: "media-1",
        // La respuesta sale de la propia cuenta, no del comentador: es lo que la
        // tercera señal anti-bucle compara cuando el comentario vuelva.
        fromProviderUserId: IG_ACCOUNT,
        status: "sent",
      })
    )
  })

  // Un comentario se mide en caracteres y no en los 1000 bytes del DM.
  it("rejects a reply over 2200 characters before calling Meta", async () => {
    const replyToComment = vi.fn()
    const service = instagramService({}, { replyToComment })

    await expect(
      service.replyToComment({
        tenantId: TENANT,
        commentId: COMMENT_ID,
        idempotencyKey: "idem-1",
        reply: { text: "a".repeat(2201) },
      })
    ).rejects.toMatchObject({ code: "validation_error", status: 400 })
    expect(replyToComment).not.toHaveBeenCalled()
  })

  // Instagram no limita las respuestas públicas por comentario, así que un
  // reintento sin clave publica un segundo comentario visible.
  it("replays the stored result instead of publishing twice", async () => {
    const replyToComment = vi.fn()
    const service = instagramService(
      { getOutboundCommentByIdempotency: async () => outboundComment() },
      { replyToComment }
    )

    const result = await service.replyToComment({
      tenantId: TENANT,
      commentId: COMMENT_ID,
      idempotencyKey: "idem-1",
      reply: { text: "gracias!" },
    })

    expect(result).toMatchObject({ replayed: true, created: false })
    expect(replyToComment).not.toHaveBeenCalled()
  })

  it("persists the failed attempt and surfaces the provider reason", async () => {
    const insertOutboundComment = vi.fn(async () =>
      outboundComment({ status: "failed", providerCommentId: null })
    )
    const service = instagramService(
      { insertOutboundComment },
      {
        replyToComment: async () => ({
          ok: false as const,
          kind: "rejected" as const,
          message: "Instagram rejected the comment id",
          response: null,
        }),
      }
    )

    await expect(
      service.replyToComment({
        tenantId: TENANT,
        commentId: COMMENT_ID,
        idempotencyKey: "idem-1",
        reply: { text: "gracias!" },
      })
    ).rejects.toMatchObject({ code: "provider_rejected", status: 422 })
    expect(insertOutboundComment).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", providerCommentId: null })
    )
  })
})

describe("private replies to comments", () => {
  it("sends the DM to whoever commented and stamps the source comment", async () => {
    const completeOutbound = vi.fn(async () => message())
    const sendPrivateReply = vi.fn(async () => ({
      ok: true as const,
      messageId: "mid-1",
      response: { message_id: "mid-1" },
    }))
    const service = instagramService({ completeOutbound }, { sendPrivateReply })

    await service.sendPrivateReply({
      tenantId: TENANT,
      commentId: COMMENT_ID,
      idempotencyKey: "idem-1",
      reply: { text: "te escribo por privado" },
    })

    expect(completeOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        // El destinatario sale del comentario guardado, no del cuerpo.
        contactId: "9876543210",
        sourceCommentId: "ig-comment-1",
        // Instagram no consume cuota.
        periodStart: null,
      })
    )
  })

  // Meta lo rechaza con un 100/2534025 que junta cuatro causas y no dice cuál
  // fue; acá lo sabemos con certeza.
  it("returns 409 for a second private reply, before calling Meta", async () => {
    const sendPrivateReply = vi.fn()
    const service = instagramService(
      { getPrivateReplyForComment: async () => message() },
      { sendPrivateReply }
    )

    await expect(
      service.sendPrivateReply({
        tenantId: TENANT,
        commentId: COMMENT_ID,
        idempotencyKey: "idem-1",
        reply: { text: "segunda" },
      })
    ).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 })
    expect(sendPrivateReply).not.toHaveBeenCalled()
  })

  // Es un DM, así que rige el límite del DM: bytes, no caracteres.
  it("rejects a reply over 1000 UTF-8 bytes even when it fits in characters", async () => {
    const sendPrivateReply = vi.fn()
    const service = instagramService({}, { sendPrivateReply })

    await expect(
      service.sendPrivateReply({
        tenantId: TENANT,
        commentId: COMMENT_ID,
        idempotencyKey: "idem-1",
        reply: { text: "ñ".repeat(501) },
      })
    ).rejects.toMatchObject({ code: "validation_error", status: 400 })
    expect(sendPrivateReply).not.toHaveBeenCalled()
  })

  it("refuses to reply to an outbound comment", async () => {
    const service = instagramService({
      getComment: async () => sourceComment({ direction: "outbound" }),
    })

    await expect(
      service.sendPrivateReply({
        tenantId: TENANT,
        commentId: COMMENT_ID,
        idempotencyKey: "idem-1",
        reply: { text: "hola" },
      })
    ).rejects.toMatchObject({ code: "validation_error", status: 400 })
  })
})

describe("connecting an Instagram account", () => {
  // Una cuenta guardada que no recibe eventos se ve conectada y está muda; una
  // suscripción sin fila en la base no le hace nada a nadie.
  it("subscribes the webhook before persisting the account", async () => {
    const calls: string[] = []
    const service = instagramService(
      {
        connectInstagramAccount: async () => {
          calls.push("persist")
          return page()
        },
      },
      {
        exchangeAuthorizationCode: async () => {
          calls.push("exchange")
          return { accessToken: "ig-token", expiresAt: null }
        },
        getProfile: async () => {
          calls.push("profile")
          return {
            providerAccountId: IG_ACCOUNT,
            username: "cuenta_resender",
            name: "Cuenta",
          }
        },
        subscribeAccount: async () => {
          calls.push("subscribe")
        },
      }
    )

    const result = await service.connectInstagramAccount(
      { userId: TENANT },
      { code: "AQB123", redirectUri: "https://app.example/callback" }
    )

    expect(calls).toEqual(["exchange", "profile", "subscribe", "persist"])
    expect(result).toMatchObject({ channel: "instagram", provider: "meta" })
  })

  // El upsert no devuelve fila cuando el `where` del `do update` no aplica, y
  // eso solo pasa si la cuenta ya es de otro tenant.
  it("reports an account already owned by another tenant", async () => {
    const service = instagramService(
      { connectInstagramAccount: async () => null },
      {
        exchangeAuthorizationCode: async () => ({
          accessToken: "ig-token",
          expiresAt: null,
        }),
        getProfile: async () => ({
          providerAccountId: IG_ACCOUNT,
          username: "cuenta_resender",
          name: "Cuenta",
        }),
        subscribeAccount: async () => undefined,
      }
    )

    await expect(
      service.connectInstagramAccount(
        { userId: TENANT },
        { code: "AQB123", redirectUri: "https://app.example/callback" }
      )
    ).rejects.toMatchObject({ code: "provider_rejected", status: 422 })
  })

  // El `code` de OAuth se quema al usarlo una sola vez: rebotar después dejaría
  // al usuario sin poder reintentar, aunque le devolvieran el permiso.
  it("refuses a tenant without the channel permission without burning the OAuth code", async () => {
    const exchangeAuthorizationCode = vi.fn()
    const connect = vi.fn()
    const service = instagramService(
      {
        getUserById: async () => user({ instagramEnabled: false }),
        connectInstagramAccount: connect,
      },
      { exchangeAuthorizationCode }
    )

    await expect(
      service.connectInstagramAccount(
        { userId: TENANT },
        { code: "AQB123", redirectUri: "https://app.example/callback" }
      )
    ).rejects.toMatchObject({ code: "channel_not_enabled", status: 403 })
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })
})

// El permiso vive en `users.instagram_enabled` y se lee vivo contra la base
// (ADR 0010): apaga el canal entero, no solo la puerta de entrada, y no toca a
// Messenger.
describe("the Instagram channel permission", () => {
  it("refuses a DM to an Instagram account without the permission", async () => {
    const sendText = vi.fn()
    const reserveOutbound = vi.fn()
    const service = instagramService(
      {
        getUserById: async () => user({ instagramEnabled: false }),
        reserveOutbound,
      },
      { sendText }
    )

    await expect(
      service.sendMessage({
        tenantId: TENANT,
        idempotencyKey: "idem-1",
        message: {
          pageId: PAGE_ID,
          recipientId: "9876543210",
          type: "text",
          text: "hola",
        },
      })
    ).rejects.toMatchObject({ code: "channel_not_enabled", status: 403 })
    expect(reserveOutbound).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })

  // La contracara, que es la user story del ticket: el permiso apagado no le
  // hace nada a Messenger, y su envío ni siquiera paga la consulta del permiso.
  it("leaves a Messenger DM untouched, without an extra query", async () => {
    const getUserById = vi.fn(async () => user({ instagramEnabled: false }))
    const sendText = vi.fn(async () => ({
      ok: true as const,
      messageId: "mid-1",
      response: null,
    }))
    const service = instagramService(
      {
        getUserById,
        getPage: async () => page({ channel: "messenger", username: null }),
        getSubscription: async () => openBillingPeriod(),
      },
      {},
      { sendText }
    )

    await expect(
      service.sendMessage({
        tenantId: TENANT,
        idempotencyKey: "idem-1",
        message: {
          pageId: PAGE_ID,
          recipientId: "9876543210",
          type: "text",
          text: "hola",
        },
      })
    ).resolves.toMatchObject({ created: true })
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(getUserById).not.toHaveBeenCalled()
  })

  // Las respuestas a comentarios están cerradas por el middleware de
  // `/v1/comments/*`, así que la prueba entra por HTTP: llamar al método del
  // servicio a secas no pasaría por el gate.
  it.each([
    ["public reply", "replies", "replyToComment"],
    ["private reply", "private-replies", "sendPrivateReply"],
  ] as const)("closes the %s route", async (_name, segment, providerCall) => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const call = vi.fn()
    const service = instagramService(
      { getUserById: async () => user({ instagramEnabled: false }) },
      { [providerCall]: call } as Partial<InstagramClient>
    )

    const response = await createApp({ serviceFactory: () => service }).request(
      `https://api.resender.dev/v1/comments/${COMMENT_ID}/${segment}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer pk_live_test-secret",
          "content-type": "application/json",
          "idempotency-key": "idem-1",
        },
        body: JSON.stringify({ text: "gracias!" }),
      },
      {
        API_RATE_LIMITER: { limit: async () => ({ success: true }) },
      } as unknown as Env
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: "channel_not_enabled" },
    })
    expect(call).not.toHaveBeenCalled()
    info.mockRestore()
    warn.mockRestore()
  })

  it.each([
    ["DM", "ingestInbound"],
    ["comment", "ingestInboundComment"],
  ] as const)(
    "discards an inbound %s without persisting it",
    async (kind, persist) => {
      const call = vi.fn()
      const service = instagramService({
        getUserById: async () => user({ instagramEnabled: false }),
        [persist]: call,
      } as Partial<SqlRepository>)
      const queueSend = service.env.WEBHOOK_DELIVERIES
        .send as unknown as ReturnType<typeof vi.fn>

      await expect(
        ingest(
          service,
          kind === "DM" ? directMessagePayload() : commentPayload()
        )
      ).resolves.toEqual({ accepted: 0 })
      expect(call).not.toHaveBeenCalled()
      expect(queueSend).not.toHaveBeenCalled()
    }
  )

  // Un mismo POST de Meta trae varios eventos del mismo tenant, y el permiso se
  // cachea por lote aparte del gate de producto: dos lecturas, no una por evento.
  it("reads the account row once per payload", async () => {
    const getUserById = vi.fn(async () => user())
    const service = instagramService({ getUserById })

    await ingest(service, {
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

    expect(getUserById).toHaveBeenCalledTimes(2)
  })
})

// --- andamiaje --------------------------------------------------------------

function instagramService(
  repositoryMethods: Partial<SqlRepository>,
  instagramMethods: Partial<InstagramClient> = {},
  metaMethods: Partial<MetaClient> = {}
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
        getApiKeyByHash: async (secretHash: string) => ({
          id: "key_1",
          tenantId: TENANT,
          secretHash,
          status: "active",
          waitlisted: false,
        }),
        touchApiKey: async () => true,
        countActivePages: async () => 1,
        getUsage: async () => 0,
        getPage: async () => page(),
        getComment: async () => sourceComment(),
        isOwnPublishedComment: async () => false,
        ingestInbound: async () => inboundResult(),
        ingestInboundComment: async () => commentResult(),
        getOutboundCommentByIdempotency: async () => null,
        getOutboundByIdempotency: async () => null,
        getPrivateReplyForComment: async () => null,
        insertOutboundComment: async () => outboundComment(),
        upsertConversation: async () => ({
          id: "9e2327a8-0c42-493e-bd6c-c08ed81010f0",
          tenantId: TENANT,
          pageId: PAGE_ID,
          contactId: "9876543210",
          contactName: null,
          lastMessageAt: CREATED_AT,
        }),
        reserveOutbound: async () => ({ kind: "acquired" as const }),
        completeOutbound: async () => message(),
        markPageTokenInvalid: async () => undefined,
        connectInstagramAccount: async () => page(),
        ...repositoryMethods,
      } as unknown as SqlRepository,
      instagram: {
        sendText: async () => ({
          ok: true as const,
          messageId: "mid-1",
          response: null,
        }),
        sendPrivateReply: async () => ({
          ok: true as const,
          messageId: "mid-1",
          response: null,
        }),
        replyToComment: async () => ({
          ok: true as const,
          commentId: "ig-reply-1",
          response: null,
        }),
        ...instagramMethods,
      } as unknown as InstagramClient,
      meta: metaMethods as MetaClient,
      now: () => CREATED_AT,
    }
  )
  Object.defineProperty(service.env, "WEBHOOK_DELIVERIES", {
    value: { send: vi.fn() },
  })
  return service
}

async function ingest(service: ApiService, payload: unknown) {
  const raw = JSON.stringify(payload)
  return service.ingestInstagramWebhook(
    raw,
    `sha256=${await hmacHex("ig-secret", raw)}`
  )
}

const directMessagePayload = () => ({
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
      ],
    },
  ],
})

const commentPayload = (overrides: Record<string, unknown> = {}) => ({
  object: "instagram",
  entry: [
    {
      id: IG_ACCOUNT,
      time: 1_769_000_000,
      field: "comments",
      value: {
        id: "ig-comment-1",
        from: { id: "9876543210", username: "un_seguidor" },
        text: "qué bueno",
        media: { id: "media-1" },
        ...overrides,
      },
    },
  ],
})

function page(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id: PAGE_ID,
    tenantId: TENANT,
    channel: "instagram",
    providerPageId: IG_ACCOUNT,
    name: "Cuenta",
    username: "cuenta_resender",
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenExpiresAt: null,
    webhookUrl: "https://93.184.216.34/webhook",
    pageAccessTokenEncrypted: encryptSecret(KEY, "ig-token"),
    webhookSigningSecretEncrypted: "encrypted-secret",
    connectedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  }
}

function sourceComment(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id: COMMENT_ID,
    tenantId: TENANT,
    pageId: PAGE_ID,
    providerCommentId: "ig-comment-1",
    parentCommentId: null,
    mediaId: "media-1",
    mediaProductType: "FEED",
    fromProviderUserId: "9876543210",
    fromUsername: "un_seguidor",
    direction: "inbound",
    status: "received",
    text: "qué bueno",
    error: null,
    idempotencyKey: null,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function outboundComment(
  overrides: Partial<CommentRecord> = {}
): CommentRecord {
  return sourceComment({
    id: "6e0b9f61-4a45-4f3c-8f5f-0d1e2a3b4c5d",
    providerCommentId: "ig-reply-1",
    parentCommentId: "ig-comment-1",
    fromProviderUserId: IG_ACCOUNT,
    fromUsername: "cuenta_resender",
    direction: "outbound",
    status: "sent",
    text: "gracias!",
    idempotencyKey: "idem-1",
    ...overrides,
  })
}

function message(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: "ef55c94e-b861-4d19-9f9b-b5689028de80",
    tenantId: TENANT,
    conversationId: "9e2327a8-0c42-493e-bd6c-c08ed81010f0",
    pageId: PAGE_ID,
    contactId: "9876543210",
    direction: "outbound",
    status: "sent",
    text: "te escribo por privado",
    providerMessageId: "mid-1",
    sourceCommentId: "ig-comment-1",
    error: null,
    providerResponse: null,
    idempotencyKey: "idem-1",
    idempotencyFingerprint: "fingerprint",
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: TENANT,
    email: "tenant@example.com",
    passwordHash: "hash",
    waitlisted: false,
    instagramEnabled: true,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function subscription(
  overrides: Partial<SubscriptionRecord> = {}
): SubscriptionRecord {
  return {
    tenantId: TENANT,
    stripeSubscriptionId: "sub_1",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    lastStripeEventAt: CREATED_AT,
    ...overrides,
  }
}

// Instagram está fuera de cuota y por eso el resto del archivo nunca resuelve el
// entitlement, que se evalúa contra el reloj de pared: un período de fechas
// fijas ya venció y devuelve `plan_unavailable`. Solo el envío por Messenger lo
// necesita abierto.
const DAY_MS = 24 * 60 * 60 * 1000
function openBillingPeriod(): SubscriptionRecord {
  return subscription({
    currentPeriodStart: new Date(Date.now() - DAY_MS),
    currentPeriodEnd: new Date(Date.now() + DAY_MS),
  })
}

function inboundResult() {
  return {
    inserted: true,
    messageId: "ef55c94e-b861-4d19-9f9b-b5689028de80",
    jobId: "d743db7b-d4b8-4911-bf01-c639816856fc",
    jobStatus: "pending" as const,
    jobAttemptCount: 0,
    jobRecoverAfter: CREATED_AT,
  }
}

function commentResult() {
  return {
    inserted: true,
    commentId: COMMENT_ID,
    jobId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    jobStatus: "pending" as const,
    jobAttemptCount: 0,
  }
}
