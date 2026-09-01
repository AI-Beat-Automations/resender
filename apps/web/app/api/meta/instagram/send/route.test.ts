import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  getTenantEntitlement: vi.fn(),
  hasActiveSubscription: vi.fn(),
  isUserWaitlisted: vi.fn(),
  log: vi.fn(),
  resolveInstagramAccess: vi.fn(),
  sendInstagramTextMessage: vi.fn(),
}))

vi.mock("@/lib/billing/entitlement-status", () => ({
  getTenantEntitlement: mocks.getTenantEntitlement,
}))

vi.mock("@/lib/auth/api-keys", () => ({
  authenticateApiKey: mocks.authenticateApiKey,
}))

vi.mock("@/lib/auth/channel-access", () => ({
  resolveInstagramAccess: mocks.resolveInstagramAccess,
}))

vi.mock("@/lib/auth/waitlist", () => ({
  isUserWaitlisted: mocks.isUserWaitlisted,
}))

vi.mock("@/lib/billing/subscription", () => ({
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

// El cliente de Graph entero: si el gate se cayera, este espía es el que lo
// delata. Solo `sendInstagramTextMessage` sale a la red; el resto son puras y
// se dejan con su comportamiento real para no falsear el largo del texto.
vi.mock("@/lib/outbound/instagram-send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outbound/instagram-send")>()),
  sendInstagramTextMessage: mocks.sendInstagramTextMessage,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

vi.mock("@/lib/posthog", () => ({ posthog: null }))

import type { NextRequest } from "next/server"

import { POST } from "./route"

// La request no llega nunca a `json()` en estos casos: los gates cortan antes,
// así que un Request estándar con las cabeceras alcanza.
const sendRequest = (headers: Record<string, string> = {}) =>
  new Request("https://resender.test/api/meta/instagram/send", {
    method: "POST",
    headers: { authorization: "Bearer rk_test", ...headers },
    body: JSON.stringify({
      pageId: "ig-1",
      recipientId: "igsid-1",
      reply: "hola",
    }),
  }) as unknown as NextRequest

describe("POST /api/meta/instagram/send", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.authenticateApiKey.mockResolvedValue({ tenantId: "tenant-1" })
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(true)
    mocks.getTenantEntitlement.mockResolvedValue({
      block: null,
      periodStart: new Date("2026-08-01"),
    })
  })

  // ADR 0011: Instagram entra a facturación, así que la cuenta restringida
  // tampoco envía por acá. Antes esta ruta no tenía gate de entitlement.
  it("blocks a restricted tenant before calling Meta", async () => {
    mocks.getTenantEntitlement.mockResolvedValue({
      block: {
        code: "quota_exceeded",
        status: 402,
        message: "sin cuota",
      },
      periodStart: new Date("2026-08-01"),
    })

    const response = await POST(sendRequest())

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      error: "quota_exceeded",
      message: "sin cuota",
    })
    expect(mocks.sendInstagramTextMessage).not.toHaveBeenCalled()
  })

  // El contrato hacia afuera de la verificación de API key: 401 con `error:
  // "unauthorized"` y nada más. Vale igual para una key inventada, una revocada
  // y una vencida; el plugin distingue esos casos y `lib/auth/api-keys.ts` los
  // colapsa en `null` a propósito, para no decirle a quien prueba credenciales
  // cuál de las tres acertó.
  it("rejects a request without a valid API key", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null)

    const response = await POST(sendRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.sendInstagramTextMessage).not.toHaveBeenCalled()
  })

  // El gate de la ADR 0010: sin permiso de canal, la request muere en el worker
  // y Meta no ve nada.
  it("blocks a tenant without the Instagram channel enabled", async () => {
    mocks.resolveInstagramAccess.mockResolvedValue(false)

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "instagram channel is not enabled",
    })
    expect(mocks.sendInstagramTextMessage).not.toHaveBeenCalled()
  })

  // El replay idempotente contesta 200 sin tocar Meta, así que si el gate
  // quedara detrás suyo un tenant al que se le revocó el permiso seguiría
  // recibiendo el resultado guardado como si nada.
  it("blocks the channel before serving an idempotent replay", async () => {
    mocks.resolveInstagramAccess.mockResolvedValue(false)

    const response = await POST(
      sendRequest({ "idempotency-key": "key-already-used" })
    )

    expect(response.status).toBe(403)
    expect(mocks.sendInstagramTextMessage).not.toHaveBeenCalled()
  })

  // Los adjuntos son solo de Messenger por ahora: un body de adjunto válido
  // muere con código estable después del parser y Graph no ve nada.
  it("rejects attachments with a stable code before calling Meta", async () => {
    const response = await POST(
      new Request("https://resender.test/api/meta/instagram/send", {
        method: "POST",
        headers: { authorization: "Bearer rk_test" },
        body: JSON.stringify({
          pageId: "ig-1",
          recipientId: "igsid-1",
          attachment: {
            type: "image",
            url: "https://cdn.example.com/foto.png",
          },
        }),
      }) as unknown as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: "attachment_unsupported_channel",
      error: "attachments are not supported on Instagram yet",
    })
    expect(mocks.sendInstagramTextMessage).not.toHaveBeenCalled()
  })

  // Fail closed y en el orden canónico: el permiso de canal ni se consulta si
  // antes falta la suscripción, para que el cliente vea la causa de más arriba.
  it("reports the subscription before the channel permission", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)
    mocks.resolveInstagramAccess.mockResolvedValue(false)

    const response = await POST(sendRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "no active subscription",
    })
    expect(mocks.resolveInstagramAccess).not.toHaveBeenCalled()
  })
})
