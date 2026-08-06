import { swaggerUI } from "@hono/swagger-ui"
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi"
import {
  CommentListQuerySchema,
  CommentReplySchema,
  CommentSchema,
  ConversationListQuerySchema,
  ConversationSchema,
  dataEnvelope,
  DeliveryListQuerySchema,
  DeliverySchema,
  ErrorEnvelopeSchema,
  listEnvelope,
  MeSchema,
  MessageListQuerySchema,
  MessageSchema,
  PageListQuerySchema,
  PageSchema,
  PageUpdateSchema,
  PrivateReplySchema,
  SendMessageSchema,
  ThreadMessageListQuerySchema,
  WebhookSecretSchema,
} from "@workspace/contracts"
import { ContractError } from "@workspace/contracts"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import {
  API_JSON_BODY_LIMIT_BYTES,
  OPENAPI_VERSION,
  PROVIDER_BODY_LIMIT_BYTES,
  rateLimitFamily,
} from "../config"
import { ApiService } from "../application/service"
import { log } from "../observability/logger"

type Variables = {
  requestId: string
  startedAt: number
  tenantId: string
  service: ApiService
}

type AppBindings = {
  Bindings: Env
  Variables: Variables
}

const UuidParam = z.object({
  pageId: z.uuid().openapi({ param: { name: "pageId", in: "path" } }),
})
const ConversationParam = z.object({
  conversationId: z
    .uuid()
    .openapi({ param: { name: "conversationId", in: "path" } }),
})
const MessageParam = z.object({
  messageId: z.uuid().openapi({ param: { name: "messageId", in: "path" } }),
})
// El uuid de Resender y no el id de Instagram: el resto de la API se direcciona
// por uuid propio, y el id de Meta viaja en el cuerpo como `providerCommentId`.
const CommentParam = z.object({
  commentId: z.uuid().openapi({ param: { name: "commentId", in: "path" } }),
})
const IdempotencyHeader = z.object({
  "Idempotency-Key": z
    .string()
    .min(1)
    .max(200)
    .openapi({
      param: { name: "Idempotency-Key", in: "header" },
      example: "order_42_confirmation",
    }),
})

const meRoute = createRoute({
  method: "get",
  path: "/v1/me",
  tags: ["Identity"],
  security: [{ bearerAuth: [] }],
  responses: responses(dataEnvelope(MeSchema), "Current API tenant", {
    data: {
      tenantId: "6b402566-9e1d-4739-bb61-81ac615a5469",
      plan: { status: "active", lookupKey: "starter_monthly" },
    },
  }),
})
const pagesRoute = createRoute({
  method: "get",
  path: "/v1/pages",
  tags: ["Pages"],
  security: [{ bearerAuth: [] }],
  request: { query: PageListQuerySchema },
  responses: responses(
    listEnvelope(PageSchema),
    "Connected Pages",
    listExample(pageExample())
  ),
})
const pageRoute = createRoute({
  method: "get",
  path: "/v1/pages/{pageId}",
  tags: ["Pages"],
  security: [{ bearerAuth: [] }],
  request: { params: UuidParam },
  responses: responses(dataEnvelope(PageSchema), "Connected Page", {
    data: pageExample(),
  }),
})
const updatePageRoute = createRoute({
  method: "patch",
  path: "/v1/pages/{pageId}",
  tags: ["Pages"],
  security: [{ bearerAuth: [] }],
  request: {
    params: UuidParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PageUpdateSchema,
          example: {
            webhookUrl: "https://example.com/webhooks/resender",
          },
        },
      },
    },
  },
  responses: responses(dataEnvelope(PageSchema), "Updated Page", {
    data: pageExample(),
  }),
})
const rotateSecretRoute = createRoute({
  method: "post",
  path: "/v1/pages/{pageId}/webhook-secret/rotate",
  tags: ["Pages"],
  security: [{ bearerAuth: [] }],
  request: { params: UuidParam },
  responses: responses(
    dataEnvelope(WebhookSecretSchema),
    "One-time webhook signing secret",
    {
      data: {
        secret: "whsec_rotate_and_store_this_value",
        createdAt: "2026-07-29T18:00:00.000Z",
      },
    }
  ),
})
const conversationsRoute = createRoute({
  method: "get",
  path: "/v1/conversations",
  tags: ["Conversations"],
  security: [{ bearerAuth: [] }],
  request: { query: ConversationListQuerySchema },
  responses: responses(
    listEnvelope(ConversationSchema),
    "Tenant conversations",
    listExample(conversationExample())
  ),
})
const conversationRoute = createRoute({
  method: "get",
  path: "/v1/conversations/{conversationId}",
  tags: ["Conversations"],
  security: [{ bearerAuth: [] }],
  request: { params: ConversationParam },
  responses: responses(dataEnvelope(ConversationSchema), "Conversation", {
    data: conversationExample(),
  }),
})
const threadRoute = createRoute({
  method: "get",
  path: "/v1/conversations/{conversationId}/messages",
  tags: ["Conversations", "Messages"],
  security: [{ bearerAuth: [] }],
  request: {
    params: ConversationParam,
    query: ThreadMessageListQuerySchema,
  },
  responses: responses(
    listEnvelope(MessageSchema),
    "Conversation messages",
    listExample(messageExample())
  ),
})
const messagesRoute = createRoute({
  method: "get",
  path: "/v1/messages",
  tags: ["Messages"],
  security: [{ bearerAuth: [] }],
  request: { query: MessageListQuerySchema },
  responses: responses(
    listEnvelope(MessageSchema),
    "Tenant messages",
    listExample(messageExample())
  ),
})
const sendMessageRoute = createRoute({
  method: "post",
  path: "/v1/messages",
  tags: ["Messages"],
  security: [{ bearerAuth: [] }],
  request: {
    headers: IdempotencyHeader,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: SendMessageSchema,
          example: {
            pageId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
            recipientId: "page-scoped-psid",
            type: "text",
            text: "Your order is ready",
          },
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      dataEnvelope(MessageSchema),
      "Idempotent replay",
      { data: messageExample() },
      {
        "Idempotent-Replayed": {
          description: "Always true when the stored result was replayed",
          schema: { type: "string" as const, enum: ["true"] },
        },
      }
    ),
    201: jsonResponse(dataEnvelope(MessageSchema), "Message accepted by Meta", {
      data: messageExample(),
    }),
    ...errorResponses(),
  },
})
const messageRoute = createRoute({
  method: "get",
  path: "/v1/messages/{messageId}",
  tags: ["Messages"],
  security: [{ bearerAuth: [] }],
  request: { params: MessageParam },
  responses: responses(dataEnvelope(MessageSchema), "Message", {
    data: messageExample(),
  }),
})
const deliveriesRoute = createRoute({
  method: "get",
  path: "/v1/messages/{messageId}/deliveries",
  tags: ["Messages"],
  security: [{ bearerAuth: [] }],
  request: { params: MessageParam, query: DeliveryListQuerySchema },
  responses: responses(
    listEnvelope(DeliverySchema),
    "Webhook delivery attempts",
    listExample(deliveryExample())
  ),
})

// Los comentarios son recurso propio y no una variante de `/v1/messages`: un
// comentario cuelga de una publicación, se anida y su respuesta pública no tiene
// ventana de 24 horas. Tiene tabla propia desde la migración 0013 y por lo mismo
// rutas propias.
const commentsRoute = createRoute({
  method: "get",
  path: "/v1/comments",
  tags: ["Comments"],
  security: [{ bearerAuth: [] }],
  request: { query: CommentListQuerySchema },
  responses: responses(
    listEnvelope(CommentSchema),
    "Instagram comments",
    listExample(commentExample())
  ),
})
const commentRoute = createRoute({
  method: "get",
  path: "/v1/comments/{commentId}",
  tags: ["Comments"],
  security: [{ bearerAuth: [] }],
  request: { params: CommentParam },
  responses: responses(dataEnvelope(CommentSchema), "Instagram comment", {
    data: commentExample(),
  }),
})
const commentDeliveriesRoute = createRoute({
  method: "get",
  path: "/v1/comments/{commentId}/deliveries",
  tags: ["Comments"],
  security: [{ bearerAuth: [] }],
  request: { params: CommentParam, query: DeliveryListQuerySchema },
  responses: responses(
    listEnvelope(DeliverySchema),
    "Webhook delivery attempts",
    listExample(deliveryExample())
  ),
})
const commentReplyRoute = createRoute({
  method: "post",
  path: "/v1/comments/{commentId}/replies",
  tags: ["Comments"],
  security: [{ bearerAuth: [] }],
  request: {
    params: CommentParam,
    headers: IdempotencyHeader,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CommentReplySchema,
          example: { text: "Thanks for reaching out! We just sent you a DM." },
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      dataEnvelope(CommentSchema),
      "Idempotent replay",
      { data: commentExample() },
      {
        "Idempotent-Replayed": {
          description: "Always true when the stored result was replayed",
          schema: { type: "string" as const, enum: ["true"] },
        },
      }
    ),
    201: jsonResponse(
      dataEnvelope(CommentSchema),
      "Public reply published by Instagram",
      { data: commentExample() }
    ),
    ...errorResponses(),
  },
})
const privateReplyRoute = createRoute({
  method: "post",
  path: "/v1/comments/{commentId}/private-replies",
  tags: ["Comments", "Messages"],
  security: [{ bearerAuth: [] }],
  request: {
    params: CommentParam,
    headers: IdempotencyHeader,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PrivateReplySchema,
          example: { text: "Hi! Here is the link you asked for." },
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      dataEnvelope(MessageSchema),
      "Idempotent replay",
      { data: messageExample() },
      {
        "Idempotent-Replayed": {
          description: "Always true when the stored result was replayed",
          schema: { type: "string" as const, enum: ["true"] },
        },
      }
    ),
    201: jsonResponse(
      dataEnvelope(MessageSchema),
      "Private reply accepted by Instagram",
      { data: messageExample() }
    ),
    ...errorResponses(),
  },
})

export function createApp(
  options: { serviceFactory?: (env: Env) => ApiService } = {}
): OpenAPIHono<AppBindings> {
  const serviceFactory =
    options.serviceFactory ?? ((env: Env) => new ApiService(env))
  const app = new OpenAPIHono<AppBindings>({
    defaultHook: (result) => {
      if (result.success) return
      throw new ContractError({
        code: "validation_error",
        message: "The request is invalid.",
        status: 400,
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      })
    },
  })
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "Resender API key",
    description: "Use a tenant API key with the pk_live_ prefix.",
  })

  app.use("*", async (context, next) => {
    const supplied = context.req.header("x-request-id")
    const requestId =
      supplied && /^[\w.:/-]{1,128}$/u.test(supplied)
        ? supplied
        : crypto.randomUUID()
    context.set("requestId", requestId)
    context.set("startedAt", Date.now())
    context.set("service", serviceFactory(context.env))
    await next()
    context.header("x-request-id", requestId)
    context.header("x-content-type-options", "nosniff")
    log("info", {
      entrypoint: "fetch",
      event: "request_complete",
      requestId,
      tenantId: context.get("tenantId") || undefined,
      route: `${context.req.method} ${context.req.routePath || context.req.path}`,
      status: context.res.status,
      durationMs: Date.now() - context.get("startedAt"),
    })
  })

  app.use("/v1/*", async (context, next) => {
    await assertBodyLimit(context.req.raw, API_JSON_BODY_LIMIT_BYTES)
    const auth = await context
      .get("service")
      .authenticateApiKey(context.req.header("authorization") ?? null)
    context.set("tenantId", auth.tenantId)
    await context.get("service").requireProductAccess(auth.tenantId)
    const family = rateLimitFamily(context.req.method, context.req.path)
    const result = await context.env.API_RATE_LIMITER.limit({
      key: `${auth.tenantId}:${family}`,
    })
    if (!result.success) {
      context.header("retry-after", "60")
      throw new ContractError({
        code: "rate_limited",
        message: "Too many requests. Retry later.",
        status: 429,
      })
    }
    await next()
  })

  app.get("/healthz", (context) =>
    context.json({ status: "ok", service: "api" }, 200)
  )
  app.get("/readyz", async (context) => {
    try {
      const ready = await context.get("service").ready()
      return context.json(
        { status: ready ? "ready" : "unavailable" },
        ready ? 200 : 503
      )
    } catch {
      return context.json({ status: "unavailable" }, 503)
    }
  })

  app.openapi(meRoute, async (context) =>
    context.json(
      { data: await context.get("service").getMe(context.get("tenantId")) },
      200
    )
  )
  app.openapi(pagesRoute, async (context) =>
    context.json(
      await context
        .get("service")
        .listPages(context.get("tenantId"), context.req.valid("query")),
      200
    )
  )
  app.openapi(pageRoute, async (context) =>
    context.json(
      {
        data: await context
          .get("service")
          .getPage(context.get("tenantId"), context.req.valid("param").pageId),
      },
      200
    )
  )
  app.openapi(updatePageRoute, async (context) =>
    context.json(
      {
        data: await context
          .get("service")
          .updatePageWebhook(
            context.get("tenantId"),
            context.req.valid("param").pageId,
            context.req.valid("json").webhookUrl
          ),
      },
      200
    )
  )
  app.openapi(rotateSecretRoute, async (context) =>
    context.json(
      {
        data: await context
          .get("service")
          .rotateWebhookSecret(
            context.get("tenantId"),
            context.req.valid("param").pageId
          ),
      },
      200
    )
  )
  app.openapi(conversationsRoute, async (context) =>
    context.json(
      await context
        .get("service")
        .listConversations(context.get("tenantId"), context.req.valid("query")),
      200
    )
  )
  app.openapi(conversationRoute, async (context) =>
    context.json(
      {
        data: await context
          .get("service")
          .getConversation(
            context.get("tenantId"),
            context.req.valid("param").conversationId
          ),
      },
      200
    )
  )
  app.openapi(threadRoute, async (context) => {
    const result = await context
      .get("service")
      .getConversationThread(
        context.get("tenantId"),
        context.req.valid("param").conversationId,
        context.req.valid("query")
      )
    return context.json(
      { data: result.messages, pagination: result.pagination },
      200
    )
  })
  app.openapi(messagesRoute, async (context) =>
    context.json(
      await context
        .get("service")
        .listMessages(context.get("tenantId"), context.req.valid("query")),
      200
    )
  )
  app.openapi(sendMessageRoute, async (context) => {
    const result = await context.get("service").sendMessage({
      tenantId: context.get("tenantId"),
      idempotencyKey: context.req.header("idempotency-key") ?? null,
      message: context.req.valid("json"),
    })
    if (result.replayed) context.header("idempotent-replayed", "true")
    return context.json({ data: result.message }, result.created ? 201 : 200)
  })
  app.openapi(messageRoute, async (context) =>
    context.json(
      {
        data: await context
          .get("service")
          .getMessage(
            context.get("tenantId"),
            context.req.valid("param").messageId
          ),
      },
      200
    )
  )
  app.openapi(deliveriesRoute, async (context) =>
    context.json(
      await context
        .get("service")
        .listDeliveries(
          context.get("tenantId"),
          context.req.valid("param").messageId,
          context.req.valid("query")
        ),
      200
    )
  )

  app.openapi(commentsRoute, async (context) =>
    context.json(
      await context
        .get("service")
        .listComments(context.get("tenantId"), context.req.valid("query")),
      200
    )
  )
  app.openapi(commentRoute, async (context) =>
    context.json(
      {
        data: await context
          .get("service")
          .getComment(
            context.get("tenantId"),
            context.req.valid("param").commentId
          ),
      },
      200
    )
  )
  app.openapi(commentDeliveriesRoute, async (context) =>
    context.json(
      await context
        .get("service")
        .listCommentDeliveries(
          context.get("tenantId"),
          context.req.valid("param").commentId,
          context.req.valid("query")
        ),
      200
    )
  )
  app.openapi(commentReplyRoute, async (context) => {
    const result = await context.get("service").replyToComment({
      tenantId: context.get("tenantId"),
      commentId: context.req.valid("param").commentId,
      idempotencyKey: context.req.header("idempotency-key") ?? null,
      reply: context.req.valid("json"),
    })
    if (result.replayed) context.header("idempotent-replayed", "true")
    return context.json({ data: result.comment }, result.created ? 201 : 200)
  })
  app.openapi(privateReplyRoute, async (context) => {
    const result = await context.get("service").sendPrivateReply({
      tenantId: context.get("tenantId"),
      commentId: context.req.valid("param").commentId,
      idempotencyKey: context.req.header("idempotency-key") ?? null,
      reply: context.req.valid("json"),
    })
    if (result.replayed) context.header("idempotent-replayed", "true")
    return context.json({ data: result.message }, result.created ? 201 : 200)
  })

  app.get("/webhooks/meta", (context) => {
    const mode = context.req.query("hub.mode")
    const verifyToken = context.req.query("hub.verify_token")
    const challenge = context.req.query("hub.challenge")
    if (
      mode !== "subscribe" ||
      verifyToken !== context.env.META_VERIFY_TOKEN ||
      !challenge
    ) {
      return context.text("forbidden", 403)
    }
    return context.text(challenge, 200)
  })
  app.post("/webhooks/meta", async (context) => {
    const raw = await readRawLimited(context.req.raw, PROVIDER_BODY_LIMIT_BYTES)
    const result = await context
      .get("service")
      .ingestMetaWebhook(raw, context.req.header("x-hub-signature-256") ?? null)
    return context.json({ ok: true, accepted: result.accepted }, 200)
  })
  // Ruta propia y no una rama dentro de `/webhooks/meta` por una razón
  // concreta: **el secreto que firma es otro**. `INSTAGRAM_APP_SECRET` es
  // distinto de `META_APP_SECRET` aunque los dos vivan en la misma app de Meta.
  // Compartir la ruta obligaría a adivinar con cuál verificar cada payload —o a
  // probar los dos, que es peor—. El verify token también es propio, porque cada
  // webhook se registra por separado en el panel de Meta.
  app.get("/webhooks/meta/instagram", (context) => {
    const mode = context.req.query("hub.mode")
    const verifyToken = context.req.query("hub.verify_token")
    const challenge = context.req.query("hub.challenge")
    if (
      mode !== "subscribe" ||
      verifyToken !== context.env.INSTAGRAM_VERIFY_TOKEN ||
      !challenge
    ) {
      return context.text("forbidden", 403)
    }
    return context.text(challenge, 200)
  })
  app.post("/webhooks/meta/instagram", async (context) => {
    const raw = await readRawLimited(context.req.raw, PROVIDER_BODY_LIMIT_BYTES)
    const result = await context
      .get("service")
      .ingestInstagramWebhook(
        raw,
        context.req.header("x-hub-signature-256") ?? null
      )
    return context.json({ ok: true, accepted: result.accepted }, 200)
  })
  app.post("/webhooks/stripe", async (context) => {
    const raw = await readRawLimited(context.req.raw, PROVIDER_BODY_LIMIT_BYTES)
    const result = await context
      .get("service")
      .handleStripeWebhook(raw, context.req.header("stripe-signature") ?? null)
    return context.json(result, 200)
  })

  app.get("/docs", swaggerUI({ url: "/openapi.json" }))
  app.get("/openapi.json", (context) =>
    context.json(getOpenApiDocument(app), 200)
  )
  app.get("/openapi/download", (context) => {
    context.header(
      "content-disposition",
      'attachment; filename="resender-openapi-v1.json"'
    )
    return context.json(getOpenApiDocument(app), 200)
  })

  app.notFound(() => {
    throw notFoundError()
  })
  app.onError((error, context) => {
    const requestId = context.get("requestId") || crypto.randomUUID()
    const contract =
      error instanceof ContractError
        ? error
        : new ContractError({
            code: "internal_error",
            message: "An unexpected error occurred.",
            status: 500,
          })
    log(contract.status >= 500 ? "error" : "warn", {
      entrypoint: "fetch",
      event: "request_error",
      requestId,
      tenantId: context.get("tenantId") || undefined,
      route: `${context.req.method} ${context.req.path}`,
      status: contract.status,
      durationMs: Date.now() - (context.get("startedAt") || Date.now()),
      errorCode: contract.code,
    })
    return context.json(
      {
        error: {
          code: contract.code,
          message: contract.message,
          requestId,
          ...(contract.details ? { details: contract.details } : {}),
        },
      },
      normalizeStatus(contract.status)
    )
  })

  return app
}

export function getOpenApiDocument(app: OpenAPIHono<AppBindings>) {
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Resender API",
      version: OPENAPI_VERSION,
      description:
        "Server-to-server API for connected Meta Pages, conversations, and messages.\n\n" +
        "```bash\n" +
        "curl https://api.resender.dev/v1/me \\\n" +
        '  -H "Authorization: Bearer pk_live_..."\n' +
        "```",
    },
    servers: [
      { url: "https://api.resender.dev", description: "Production" },
      { url: "http://localhost:8787", description: "Local development" },
    ],
    security: [{ bearerAuth: [] }],
  })
}

export function getRegisteredPublicV1Routes(
  app: OpenAPIHono<AppBindings>
): string[] {
  return [
    ...new Set(
      app.routes
        .filter(
          (route) =>
            route.path.startsWith("/v1/") &&
            ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(route.method)
        )
        .map(
          (route) =>
            `${route.method} ${route.path.replace(/:([^/]+)/gu, "{$1}")}`
        )
    ),
  ]
}

async function assertBodyLimit(
  request: Request,
  maximum: number
): Promise<void> {
  if (request.method === "GET" || request.method === "HEAD") return
  const length = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(length) && length > maximum) throw bodyTooLarge()
  const reader = request.clone().body?.getReader()
  if (!reader) return
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    total += value.byteLength
    if (total > maximum) {
      await reader.cancel()
      throw bodyTooLarge()
    }
  }
}

async function readRawLimited(
  request: Request,
  maximum: number
): Promise<string> {
  const length = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(length) && length > maximum) throw bodyTooLarge()
  const reader = request.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let total = 0
  let result = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) return result + decoder.decode()
    total += value.byteLength
    if (total > maximum) {
      await reader.cancel()
      throw bodyTooLarge()
    }
    result += decoder.decode(value, { stream: true })
  }
}

function bodyTooLarge(): ContractError {
  return new ContractError({
    code: "validation_error",
    message: "The request body is too large.",
    status: 413,
  })
}

function notFoundError(): ContractError {
  return new ContractError({
    code: "not_found",
    message: "The requested route was not found.",
    status: 404,
  })
}

function normalizeStatus(value: number): ContentfulStatusCode {
  return value >= 400 && value <= 599 ? (value as ContentfulStatusCode) : 500
}

function jsonResponse(
  schema: z.ZodType,
  description: string,
  example?: unknown,
  additionalHeaders: Record<string, unknown> = {}
) {
  return {
    description,
    headers: {
      "X-Request-Id": {
        description: "Request correlation identifier",
        schema: { type: "string" as const },
      },
      ...additionalHeaders,
    },
    content: {
      "application/json": {
        schema,
        ...(example === undefined ? {} : { example }),
      },
    },
  }
}

function errorResponses() {
  return {
    400: jsonResponse(
      ErrorEnvelopeSchema,
      "Invalid request",
      errorExample("validation_error")
    ),
    401: jsonResponse(
      ErrorEnvelopeSchema,
      "Missing or invalid API key",
      errorExample("invalid_api_key")
    ),
    402: jsonResponse(
      ErrorEnvelopeSchema,
      "Message quota exhausted",
      errorExample("quota_exceeded")
    ),
    403: jsonResponse(
      ErrorEnvelopeSchema,
      "Account or plan restriction",
      errorExample("subscription_required")
    ),
    404: jsonResponse(
      ErrorEnvelopeSchema,
      "Resource not found",
      errorExample("not_found")
    ),
    409: jsonResponse(
      ErrorEnvelopeSchema,
      "Idempotency conflict",
      errorExample("idempotency_conflict")
    ),
    413: jsonResponse(
      ErrorEnvelopeSchema,
      "Request body too large",
      errorExample("validation_error")
    ),
    422: jsonResponse(
      ErrorEnvelopeSchema,
      "Provider rejected the request",
      errorExample("provider_rejected")
    ),
    429: jsonResponse(
      ErrorEnvelopeSchema,
      "Technical rate limit exceeded",
      errorExample("rate_limited"),
      {
        "Retry-After": {
          description: "Seconds before the client should retry",
          schema: { type: "integer" as const, example: 60 },
        },
      }
    ),
    500: jsonResponse(
      ErrorEnvelopeSchema,
      "Internal error",
      errorExample("internal_error")
    ),
    502: jsonResponse(
      ErrorEnvelopeSchema,
      "Provider unavailable",
      errorExample("provider_unavailable")
    ),
  }
}

function responses(schema: z.ZodType, description: string, example: unknown) {
  return {
    200: jsonResponse(schema, description, example),
    ...errorResponses(),
  }
}

function pageExample() {
  return {
    id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
    provider: "meta",
    channel: "messenger",
    providerPageId: "104287000000001",
    name: "Acme Support",
    username: null,
    status: "active",
    tokenStatus: "valid",
    webhook: {
      url: "https://example.com/webhooks/resender",
      signingEnabled: true,
    },
    connectedAt: "2026-07-29T18:00:00.000Z",
    updatedAt: "2026-07-29T18:00:00.000Z",
  }
}

function messageExample() {
  return {
    id: "ef55c94e-b861-4d19-9f9b-b5689028de80",
    conversationId: "9e2327a8-0c42-493e-bd6c-c08ed81010f0",
    pageId: pageExample().id,
    contactId: "page-scoped-psid",
    direction: "inbound",
    status: "received",
    type: "text",
    text: "Where is my order?",
    provider: { name: "meta", messageId: "mid.1" },
    failure: null,
    sourceCommentId: null,
    createdAt: "2026-07-29T18:00:00.000Z",
  }
}

function commentExample() {
  return {
    id: "1f0c9b2e-6d2a-4a5f-9f43-2f9a4b6d0c11",
    pageId: "3b1f4e0a-8d61-4c92-9a77-1c53b0e2a740",
    providerCommentId: "17982334455667788",
    parentCommentId: null,
    mediaId: "17895695668004550",
    mediaProductType: "FEED",
    from: { providerUserId: "7042996714312345", username: "ada.lovelace" },
    direction: "inbound",
    status: "received",
    text: "Do you ship to Argentina?",
    failure: null,
    createdAt: "2026-07-29T18:00:00.000Z",
  }
}

function conversationExample() {
  const page = pageExample()
  const message = messageExample()
  return {
    id: message.conversationId,
    page: {
      id: page.id,
      providerPageId: page.providerPageId,
      name: page.name,
    },
    contact: { id: message.contactId, name: "Ada" },
    latestMessage: {
      id: message.id,
      text: message.text,
      direction: message.direction,
      status: message.status,
      createdAt: message.createdAt,
    },
    lastMessageAt: message.createdAt,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
  }
}

function deliveryExample() {
  return {
    id: "d743db7b-d4b8-4911-bf01-c639816856fc",
    eventId: "evt_feb9cf7355c04b7eb44a",
    attempt: 1,
    status: "success",
    statusCode: 204,
    error: null,
    attemptedAt: "2026-07-29T18:00:01.000Z",
  }
}

function listExample(item: unknown) {
  return {
    data: [item],
    pagination: { hasMore: false, nextCursor: null },
  }
}

function errorExample(code: string) {
  return {
    error: {
      code,
      message: "The request could not be completed.",
      requestId: "req_01J7Y9DPW9X3XQZP8W9V7R8Q0M",
    },
  }
}
