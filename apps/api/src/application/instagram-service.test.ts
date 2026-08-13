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
import type { InstagramClient } from "../infrastructure/meta/instagram-client"
import { ApiService } from "./service"

const CREATED_AT = new Date("2026-07-29T18:00:00.000Z")

// El período de facturación va relativo al reloj real y no a `CREATED_AT`, igual
// que en `service.test.ts`: `entitlement()` lo evalúa contra `new Date()`, así
// que un período fijo caduca y deja todo Instagram en `plan_unavailable`. Desde
// el ADR 0010 Instagram resuelve el entitlement, así que esto ya le importa.
const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_START = new Date(Date.now() - 15 * DAY_MS)
const PERIOD_END = new Date(Date.now() + 15 * DAY_MS)
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

  // ADR 0010: Instagram entró a facturación. Antes este test fijaba lo
  // contrario —`periodStart: null` y entrega siempre habilitada—; ahora el DM
  // viaja con el período real y con la entrega atada al bloqueo del tenant.
  it("ingests a DM with the real billing period and delivery tied to the block", async () => {
    const ingestInbound = vi.fn(async () => inboundResult())
    const getUsage = vi.fn(async () => 0)
    const service = instagramService({ ingestInbound, getUsage })

    await expect(ingest(service, directMessagePayload())).resolves.toEqual({
      accepted: 1,
    })
    expect(ingestInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: subscription().currentPeriodStart,
        deliveryEnabled: true,
        deliveryBlockedReason: null,
      })
    )
    expect(getUsage).toHaveBeenCalled()
  })

  // La contracara de consumir cuota: el tenant restringido deja de recibir sus
  // DMs de Instagram reenviados, igual que los de Messenger.
  it("stops delivering the DM when the tenant is restricted, but still ingests it", async () => {
    const ingestInbound = vi.fn(async () => inboundResult())
    const service = instagramService({
      ingestInbound,
      getUsage: async () => 50_000,
    })

    await expect(ingest(service, directMessagePayload())).resolves.toEqual({
      accepted: 1,
    })
    expect(ingestInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryEnabled: false,
        deliveryBlockedReason: "account is restricted: quota_exceeded",
      })
    )
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
        // ADR 0010: la respuesta privada es un DM y consume una unidad. Este
        // test fijaba `periodStart: null`, que era la decisión anterior.
        periodStart: subscription().currentPeriodStart,
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

  // ADR 0010: una cuenta de Instagram ocupa un slot del plan. Sin este gate,
  // conectar una de más empujaría al tenant a `page_limit_exceeded`, que bloquea
  // **los dos canales**: le mataría en silencio el tráfico de Messenger.
  it("refuses a new account when the plan has no slots left", async () => {
    const connectInstagramAccount = vi.fn(async () => page())
    const subscribeAccount = vi.fn(async () => undefined)
    const service = instagramService(
      {
        connectInstagramAccount,
        // starter_monthly permite 2 y ya tiene 2 activas.
        countActiveAccounts: async () => 2,
        getAccountOwnership: async () => ({ owner: "none" as const }),
      },
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
        subscribeAccount,
      }
    )

    await expect(
      service.connectInstagramAccount(
        { userId: TENANT },
        { code: "AQB123", redirectUri: "https://app.example/callback" }
      )
    ).rejects.toMatchObject({ code: "page_limit_exceeded", status: 403 })

    // Antes de suscribir: rechazar después dejaría a Meta con una suscripción
    // colgando de una cuenta que no conectamos.
    expect(subscribeAccount).not.toHaveBeenCalled()
    expect(connectInstagramAccount).not.toHaveBeenCalled()
  })

  // Renovar el token de una cuenta que ya está activa no consume un slot nuevo:
  // ya estaba contada. En Instagram el token vence a los ~60 días, así que
  // cobrárselo dejaría sin salida a quien esté justo en el tope.
  it("allows re-authorizing an account that is already active at the cap", async () => {
    const service = instagramService(
      {
        countActiveAccounts: async () => 2,
        getAccountOwnership: async () => ({
          owner: "self" as const,
          status: "active" as const,
        }),
      },
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
    ).resolves.toMatchObject({ channel: "instagram" })
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
})

// --- andamiaje --------------------------------------------------------------

function instagramService(
  repositoryMethods: Partial<SqlRepository>,
  instagramMethods: Partial<InstagramClient> = {}
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
        // Desde el ADR 0010 Instagram resuelve el entitlement como Messenger, y
        // eso son dos lecturas más: el consumo del período y las cuentas activas.
        getUsage: async () => 0,
        countActiveAccounts: async () => 1,
        getAccountOwnership: async () => ({ owner: "none" as const }),
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
