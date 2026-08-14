import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  hasActiveSubscription: vi.fn(),
  isUserWaitlisted: vi.fn(),
  resolveInstagramAccess: vi.fn(),
}))

vi.mock("@/lib/api-keys/api-keys", () => ({
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

import type { NextRequest } from "next/server"

import { authenticateCommentReplyRequest } from "./comment-reply-request"

// El módulo solo lee `headers`, así que un Request estándar alcanza y evita
// construir el NextRequest entero por dos cabeceras.
const requestWithKey = () =>
  new Request("https://resender.test/api/meta/instagram/comments/reply", {
    method: "POST",
    headers: { authorization: "Bearer rk_test" },
  }) as unknown as NextRequest

describe("authenticateCommentReplyRequest", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.authenticateApiKey.mockResolvedValue({ tenantId: "tenant-1" })
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(true)
  })

  it("lets through a tenant with the Instagram channel enabled", async () => {
    const result = await authenticateCommentReplyRequest(requestWithKey())

    expect(result).toEqual({
      ok: true,
      value: { tenantId: "tenant-1", idempotencyKey: null },
    })
  })

  // Es el gate de la ADR 0010 para las dos rutas de comentarios: si se cayera,
  // un tenant sin permiso podría responder comentarios por API.
  it("blocks a tenant without the Instagram channel enabled", async () => {
    mocks.resolveInstagramAccess.mockResolvedValue(false)

    const result = await authenticateCommentReplyRequest(requestWithKey())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")

    expect(result.reason).toBe("channel_not_enabled")
    expect(result.response.status).toBe(403)
    await expect(result.response.json()).resolves.toEqual({
      error: "instagram channel is not enabled",
    })
  })

  // Fail closed y en el orden canónico: el motivo que ve el cliente es el
  // primero que lo bloquea, y el permiso de canal ni siquiera se consulta.
  it("reports the subscription before the channel permission", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)
    mocks.resolveInstagramAccess.mockResolvedValue(false)

    const result = await authenticateCommentReplyRequest(requestWithKey())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")

    expect(result.reason).toBe("no_active_subscription")
    expect(mocks.resolveInstagramAccess).not.toHaveBeenCalled()
  })
})
