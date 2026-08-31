import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  getOutboundMessageByIdempotencyKey: vi.fn(),
  getTenantEntitlement: vi.fn(),
  hasActiveSubscription: vi.fn(),
  isUserWaitlisted: vi.fn(),
  log: vi.fn(),
  resolveWhatsappAccess: vi.fn(),
}))

vi.mock("@/lib/api-keys/api-keys", () => ({
  authenticateApiKey: mocks.authenticateApiKey,
}))

vi.mock("@/lib/auth/channel-access", () => ({
  resolveWhatsappAccess: mocks.resolveWhatsappAccess,
}))

vi.mock("@/lib/auth/waitlist", () => ({
  isUserWaitlisted: mocks.isUserWaitlisted,
}))

vi.mock("@/lib/billing/entitlement-status", () => ({
  getTenantEntitlement: mocks.getTenantEntitlement,
}))

vi.mock("@/lib/billing/subscription", () => ({
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

vi.mock("@/lib/messages/message-log", () => ({
  getOutboundMessageByIdempotencyKey: mocks.getOutboundMessageByIdempotencyKey,
}))

// El logger real, con sólo el `log` espiado: el `reason` de cada descarte es
// contrato de observabilidad —hay alertas que filtran por él— y se verifica
// como tal, no como "se llamó al helper".
vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

import { outboundLogger } from "@/lib/observability/outbound-log"

import { isUniqueViolation, runWhatsappSendGates } from "./whatsapp-send-gates"

const PERIOD_START = new Date("2026-08-01T00:00:00.000Z")

const newTrace = () =>
  outboundLogger({
    action: "outbound_send",
    channel: "whatsapp",
    subject: "message",
    requestId: "req-1",
  })

const gatesRequest = (
  body: unknown = { pageId: "phone-1", recipientId: "5491100000000" },
  headers: Record<string, string> = {}
) =>
  new Request("https://resender.test/api/meta/whatsapp/send", {
    method: "POST",
    headers: {
      authorization: "Bearer rk_test",
      "idempotency-key": "key-1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

const run = (...args: Parameters<typeof gatesRequest>) =>
  runWhatsappSendGates({ request: gatesRequest(...args), trace: newTrace() })

// El `reason` de la última línea de log escrita.
const lastReason = () =>
  (mocks.log.mock.calls.at(-1)?.[0] as { reason?: string } | undefined)?.reason

describe("runWhatsappSendGates", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    // Autentica sólo el token real, para que el test del `Authorization` mal
    // formado verifique que la cabecera se parsea y no que el mock dice que sí.
    mocks.authenticateApiKey.mockImplementation(async (token: unknown) =>
      token === "rk_test" ? { id: "key-id", tenantId: "tenant-1" } : null
    )
    mocks.resolveWhatsappAccess.mockResolvedValue(true)
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.getTenantEntitlement.mockResolvedValue({
      block: null,
      periodStart: PERIOD_START,
    })
    mocks.getOutboundMessageByIdempotencyKey.mockResolvedValue(null)
  })

  // ---- el camino feliz ----------------------------------------------------
  // Lo que la ruta necesita después sale de acá ya resuelto: el tenant, la
  // clave normalizada, el período estrechado a `Date` y el body sin
  // interpretar, que es lo que deja que cada ruta le aplique su propio parser.
  it("hands back the tenant, the key, the period and the raw body", async () => {
    const result = await run(
      { pageId: "phone-1", recipientId: "549110", template: { name: "x" } },
      { "idempotency-key": "  key-1  " }
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.apiKey.tenantId).toBe("tenant-1")
    expect(result.idempotencyKey).toBe("key-1")
    expect(result.periodStart).toEqual(PERIOD_START)
    expect(result.body).toEqual({
      pageId: "phone-1",
      recipientId: "549110",
      template: { name: "x" },
    })
  })

  // ---- 1. API key ---------------------------------------------------------
  // El 401 va primero de todo: contestar antes un 403 le diría a un
  // desconocido si el tenant existe o qué canales tiene contratados.
  it("401s without a valid API key and asks nothing else", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const result = await run()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(401)
    await expect(result.response.json()).resolves.toEqual({
      error: "unauthorized",
    })
    expect(lastReason()).toBe("unauthorized")
    expect(mocks.resolveWhatsappAccess).not.toHaveBeenCalled()
    expect(mocks.getTenantEntitlement).not.toHaveBeenCalled()
  })

  // Sin el esquema `Bearer` no hay token que autenticar: la cabecera se parsea
  // acá y lo que llega al autenticador es `null`, no la cabecera cruda.
  it("rejects an Authorization header that is not a bearer token", async () => {
    const result = await run(undefined, { authorization: "rk_test" })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(401)
    expect(mocks.authenticateApiKey).toHaveBeenCalledWith(null)
  })

  // ---- 2. Idempotency-Key -------------------------------------------------
  it("400s when the Idempotency-Key is missing", async () => {
    const result = await run(undefined, { "idempotency-key": "   " })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(400)
    expect(lastReason()).toBe("invalid_request")
    expect(mocks.resolveWhatsappAccess).not.toHaveBeenCalled()
  })

  it("400s when the Idempotency-Key is longer than 200 characters", async () => {
    const result = await run(undefined, {
      "idempotency-key": "k".repeat(201),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(400)
  })

  // ---- 3. Permiso de canal ------------------------------------------------
  // El código es genérico —el mismo que en Messenger e Instagram— y es el
  // `message` el que nombra a WhatsApp.
  it("403s a tenant without the WhatsApp channel enabled", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)

    const result = await run()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    await expect(result.response.json()).resolves.toEqual({
      error: "channel_not_enabled",
      message: "whatsapp channel is not enabled",
    })
    expect(lastReason()).toBe("channel_not_enabled")
  })

  // **El orden que más fácil se rompe al refactorizar.** Si el replay quedara
  // delante, a un tenant al que se le revocó el canal le seguiría llegando un
  // 200 con el resultado guardado de cuando podía enviar.
  it("blocks the channel before looking up the idempotent replay", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)

    const result = await run()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    expect(mocks.getOutboundMessageByIdempotencyKey).not.toHaveBeenCalled()
  })

  // ---- 4. Waitlist, suscripción y cuota -----------------------------------
  it("403s an account on the waitlist", async () => {
    mocks.isUserWaitlisted.mockResolvedValue(true)

    const result = await run()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    await expect(result.response.json()).resolves.toEqual({
      error: "account is on the waitlist",
    })
    expect(lastReason()).toBe("waitlisted")
  })

  it("403s an account without an active subscription", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    const result = await run()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    await expect(result.response.json()).resolves.toEqual({
      error: "no active subscription",
    })
    expect(lastReason()).toBe("no_active_subscription")
  })

  // El bloqueo trae su propio status y su propio código: la ruta no los
  // reinterpreta, los devuelve.
  it("answers the entitlement block with its own status and code", async () => {
    mocks.getTenantEntitlement.mockResolvedValue({
      block: { code: "quota_exceeded", status: 402, message: "sin cuota" },
      periodStart: PERIOD_START,
    })

    const result = await run()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(402)
    await expect(result.response.json()).resolves.toEqual({
      error: "quota_exceeded",
      message: "sin cuota",
    })
  })

  // **Fail-closed explícito.** Un período que no se pudo resolver no habilita
  // el envío "por las dudas": sin período no hay contador que incrementar y
  // dejarlo pasar sería regalar mensajes que nadie cuenta.
  it("403s when the billing period could not be resolved", async () => {
    mocks.getTenantEntitlement.mockResolvedValue({
      block: null,
      periodStart: null,
    })

    const result = await run()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    const body = await result.response.json()
    expect(body.error).toBe("plan_unavailable")
    expect(lastReason()).toBe("plan_restricted")
  })

  // ---- 5. Replay idempotente ----------------------------------------------
  it("replays a stored send with the same envelope", async () => {
    mocks.getOutboundMessageByIdempotencyKey.mockResolvedValue({
      id: "msg-old",
      conversationId: "conv-1",
      status: "sent",
      error: null,
      providerResponse: { messages: [{ id: "wamid.old" }] },
    })

    const result = await run()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(200)
    await expect(result.response.json()).resolves.toEqual({
      meta: { messages: [{ id: "wamid.old" }] },
      resender: {
        conversationId: "conv-1",
        messageId: "msg-old",
        status: "sent",
        idempotentReplay: true,
      },
    })
    expect(lastReason()).toBe("idempotent_replay")
  })

  // El fallo también se replaya, y con su error: el reintento tiene que ver lo
  // mismo que vio el primer intento, no un éxito inventado.
  it("replays a stored failure with its error", async () => {
    mocks.getOutboundMessageByIdempotencyKey.mockResolvedValue({
      id: "msg-old",
      conversationId: "conv-1",
      status: "failed",
      error: "boom",
      providerResponse: {},
    })

    const result = await run()

    expect(result.ok).toBe(false)
    if (result.ok) return
    const body = await result.response.json()
    expect(body.error).toBe("boom")
    expect(body.resender.status).toBe("failed")
  })

  // El replay gana antes de mirar el cuerpo: un reintento con el body roto
  // igual tiene que recibir el resultado que ya se guardó.
  it("replays before parsing the body", async () => {
    mocks.getOutboundMessageByIdempotencyKey.mockResolvedValue({
      id: "msg-old",
      conversationId: "conv-1",
      status: "sent",
      error: null,
      providerResponse: {},
    })

    const result = await run("{ no soy json")

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(200)
  })

  // ---- 5b. El body --------------------------------------------------------
  it("400s on a body that is not JSON", async () => {
    const result = await run("{ no soy json")

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(400)
    await expect(result.response.json()).resolves.toEqual({
      error: "invalid json",
    })
  })

  it("400s on a JSON body that is not an object", async () => {
    const result = await run("42")

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(400)
    await expect(result.response.json()).resolves.toEqual({
      error: "invalid body",
    })
  })

  // El body sale sin interpretar a propósito: acá no se sabe si la ruta espera
  // `reply`, `attachment` o `template`.
  it("does not judge which fields the body carries", async () => {
    const result = await run({ cualquier: "cosa" })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body).toEqual({ cualquier: "cosa" })
  })
})

describe("isUniqueViolation", () => {
  it("recognises the Postgres unique violation and nothing else", () => {
    expect(
      isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))
    ).toBe(true)
    expect(
      isUniqueViolation(Object.assign(new Error("otro"), { code: "23503" }))
    ).toBe(false)
    expect(isUniqueViolation(new Error("sin código"))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
