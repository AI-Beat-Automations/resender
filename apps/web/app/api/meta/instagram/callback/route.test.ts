import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveProductAccess: vi.fn(),
  resolveInstagramAccess: vi.fn(),
  hasActiveSubscription: vi.fn(),
  getSubscriptionByTenantId: vi.fn(),
  countActivePages: vi.fn(),
  getActivePageByMetaPageId: vi.fn(),
  connectInstagramAccount: vi.fn(),
  exchangeCodeForInstagramToken: vi.fn(),
  fetchInstagramProfile: vi.fn(),
  subscribeInstagramWebhook: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))

vi.mock("@/lib/auth/waitlist", () => ({
  resolveProductAccess: mocks.resolveProductAccess,
}))

vi.mock("@/lib/auth/channel-access", () => ({
  resolveInstagramAccess: mocks.resolveInstagramAccess,
}))

vi.mock("@/lib/billing/subscription", () => ({
  hasActiveSubscription: mocks.hasActiveSubscription,
  getSubscriptionByTenantId: mocks.getSubscriptionByTenantId,
}))

vi.mock("@/lib/crypto/encryption", () => {
  class SecretEncryptionConfigError extends Error {}
  return {
    assertSecretEncryptionConfigured: () => {},
    SecretEncryptionConfigError,
  }
})

// `APP_URL` sale del entorno en el módulo real y acá no hay entorno: sin esto,
// el primer `new URL(...)` del redirect rompe antes que cualquier aserción.
vi.mock("@/lib/meta", () => ({ APP_URL: "https://resender.test" }))

vi.mock("@/lib/instagram", () => {
  class InstagramApiError extends Error {
    constructor(
      message: string,
      readonly step: string
    ) {
      super(message)
    }
  }

  return {
    INSTAGRAM_STATE_COOKIE: "instagram_oauth_state",
    InstagramApiError,
    exchangeCodeForInstagramToken: mocks.exchangeCodeForInstagramToken,
    fetchInstagramProfile: mocks.fetchInstagramProfile,
    subscribeInstagramWebhook: mocks.subscribeInstagramWebhook,
  }
})

vi.mock("@/lib/pages/page-registry", () => {
  class PageOwnershipError extends Error {
    constructor(readonly metaPageId: string) {
      super("account already belongs to another tenant")
    }
  }

  return {
    connectInstagramAccount: mocks.connectInstagramAccount,
    countActivePages: mocks.countActivePages,
    getActivePageByMetaPageId: mocks.getActivePageByMetaPageId,
    PageOwnershipError,
  }
})

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

vi.mock("@/lib/posthog", () => ({ posthog: null }))

import { NextRequest } from "next/server"

import { GET } from "./route"

const STATE = "state-1"
const IG_USER_ID = "17841400000000000"

const callbackRequest = () =>
  new NextRequest(
    `https://resender.test/api/meta/instagram/callback?code=code-1&state=${STATE}`,
    { headers: { cookie: `instagram_oauth_state=${STATE}` } }
  )

const reasonOf = (response: Response) =>
  new URL(response.headers.get("location")!).searchParams.get("reason")

// El cupo del plan al conectar Instagram (ADR 0011). Starter permite 2
// conexiones y el conteo ya no distingue canal: las 2 activas pueden ser una
// Página de Facebook y una cuenta de IG.
describe("GET /api/meta/instagram/callback", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveProductAccess.mockResolvedValue("allowed")
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.resolveInstagramAccess.mockResolvedValue(true)
    mocks.getSubscriptionByTenantId.mockResolvedValue({
      priceLookupKey: "starter_monthly",
    })
    mocks.countActivePages.mockResolvedValue(0)
    mocks.getActivePageByMetaPageId.mockResolvedValue(null)
    mocks.exchangeCodeForInstagramToken.mockResolvedValue({
      accessToken: "token-1",
      expiresAt: null,
    })
    mocks.fetchInstagramProfile.mockResolvedValue({
      igUserId: IG_USER_ID,
      username: "cuenta_resender",
      name: "Cuenta",
    })
    mocks.subscribeInstagramWebhook.mockResolvedValue(undefined)
    mocks.connectInstagramAccount.mockResolvedValue({
      id: "connection-1",
      tenantId: "tenant-1",
      channel: "instagram",
      metaPageId: IG_USER_ID,
      username: "cuenta_resender",
    })
  })

  it("connects a new Instagram account while the plan has a free slot", async () => {
    mocks.countActivePages.mockResolvedValue(1)

    const response = await GET(callbackRequest())

    expect(mocks.connectInstagramAccount).toHaveBeenCalledTimes(1)
    expect(response.headers.get("location")).toContain("instagram=connected")
  })

  it("bounces a new account when every slot of the plan is taken", async () => {
    mocks.countActivePages.mockResolvedValue(2)

    const response = await GET(callbackRequest())

    expect(reasonOf(response)).toBe("instagram_page_limit_reached")
    expect(mocks.connectInstagramAccount).not.toHaveBeenCalled()
    // No se llega a suscribir el webhook de una cuenta que no se va a guardar.
    expect(mocks.subscribeInstagramWebhook).not.toHaveBeenCalled()
  })

  // Reconectar es idempotente y no consume slot nuevo: el que está en el tope
  // tiene que poder renovar el token de la cuenta que ya tiene.
  it("lets a tenant at the cap reconnect an account it already has active", async () => {
    mocks.countActivePages.mockResolvedValue(2)
    mocks.getActivePageByMetaPageId.mockResolvedValue({
      id: "connection-1",
      tenantId: "tenant-1",
      metaPageId: IG_USER_ID,
    })

    const response = await GET(callbackRequest())

    expect(mocks.connectInstagramAccount).toHaveBeenCalledTimes(1)
    expect(response.headers.get("location")).toContain("instagram=connected")
  })

  // La cuenta activa de **otro** tenant no abre la puerta: sin la comparación
  // de `tenantId`, un id ajeno sería indistinguible de una reconexión. Y rebota
  // por propiedad, no por cupo: mandarlo a liberar un slot no sirve de nada,
  // porque la cuenta va a seguir sin ser suya (ADR 0004).
  it("does not let another tenant's active account pass as a reconnection", async () => {
    mocks.countActivePages.mockResolvedValue(2)
    mocks.getActivePageByMetaPageId.mockResolvedValue({
      id: "connection-9",
      tenantId: "tenant-2",
      metaPageId: IG_USER_ID,
    })

    const response = await GET(callbackRequest())

    expect(reasonOf(response)).toBe(`instagram_account_owned:${IG_USER_ID}`)
    expect(mocks.connectInstagramAccount).not.toHaveBeenCalled()
  })

  // El orden de los gates (ADR 0010 y 0011): la suscripción primero, después el
  // permiso de canal y recién al final el cupo. Un tenant sin suscripción va a
  // /billing aunque además le falte el permiso y esté en el tope; que el cupo no
  // se consulte es lo que fija que el orden no se dé vuelta.
  it("checks the subscription before the channel permission and the plan cap", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)
    mocks.resolveInstagramAccess.mockResolvedValue(false)
    mocks.countActivePages.mockResolvedValue(2)

    const response = await GET(callbackRequest())

    expect(response.headers.get("location")).toContain("/billing")
    expect(mocks.resolveInstagramAccess).not.toHaveBeenCalled()
    expect(mocks.countActivePages).not.toHaveBeenCalled()
  })

  it("checks the channel permission before the plan cap", async () => {
    mocks.resolveInstagramAccess.mockResolvedValue(false)
    mocks.countActivePages.mockResolvedValue(2)

    const response = await GET(callbackRequest())

    expect(reasonOf(response)).toBe("instagram_not_enabled")
    expect(mocks.countActivePages).not.toHaveBeenCalled()
    expect(mocks.exchangeCodeForInstagramToken).not.toHaveBeenCalled()
  })

  // El cupo se resuelve **antes** del intercambio, que es lo único que se puede
  // hacer sin quemar el `code`: un plan que no resuelve rebota sin gastarlo.
  it("bounces before the exchange when the plan cannot be resolved", async () => {
    mocks.getSubscriptionByTenantId.mockResolvedValue({
      priceLookupKey: "algo_raro",
    })

    const response = await GET(callbackRequest())

    expect(reasonOf(response)).toBe("configuration_failed")
    expect(mocks.exchangeCodeForInstagramToken).not.toHaveBeenCalled()
  })
})
