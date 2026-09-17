import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveConnectGate: vi.fn(),
  getClientLimits: vi.fn(),
  resolveInstagramAccess: vi.fn(),
  getSubscriptionByTenantId: vi.fn(),
  countActivePages: vi.fn(),
  getActivePageByMetaPageId: vi.fn(),
  connectInstagramAccount: vi.fn(),
  exchangeCodeForInstagramToken: vi.fn(),
  fetchInstagramProfile: vi.fn(),
  subscribeInstagramWebhook: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }))

// Los gates van por actor (issue #154): el resolutor decide si es el padre o
// un cliente, y con qué tenant se conecta.
vi.mock("@/lib/clients/connect-gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clients/connect-gate")>()),
  resolveConnectGate: mocks.resolveConnectGate,
}))

vi.mock("@/lib/clients/client-limits-status", () => ({
  getClientLimits: mocks.getClientLimits,
}))

vi.mock("@/lib/auth/channel-access", () => ({
  resolveInstagramAccess: mocks.resolveInstagramAccess,
}))

vi.mock("@/lib/billing/subscription", () => ({
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
const PARENT = { tenantId: "tenant-1", userId: "tenant-1", clientAccountId: null }
const CLIENT = {
  tenantId: "tenant-1",
  userId: "user-2",
  clientAccountId: "client-1",
}

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
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveConnectGate.mockResolvedValue({ kind: "ok", actor: PARENT })
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
    mocks.resolveConnectGate.mockResolvedValue({
      kind: "no_active_subscription",
    })
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

// Conectar Instagram como cliente (issue #154, ticket 3): la fila queda en el
// tenant del padre con el `client_account_id`, el cupo sale de
// `client-limits` y el rebote nombra el veredicto para que Conexiones lo
// redacte con el nombre del padre.
describe("GET /api/meta/instagram/callback as a client", () => {
  const clientLimits = (verdict: string) => ({
    ok: true,
    ownerName: "Agencia Norte",
    limits: {
      verdict,
      remainingSlots: verdict === "allowed" ? 1 : 0,
      nearLimit: false,
      clientMaxConnections: 2,
      clientActiveCount: 1,
      planMaxPages: 5,
      tenantActiveCount: 3,
    },
  })

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.getSession.mockResolvedValue({ user: { id: "user-2" } })
    mocks.resolveConnectGate.mockResolvedValue({ kind: "ok", actor: CLIENT })
    mocks.resolveInstagramAccess.mockResolvedValue(true)
    mocks.getClientLimits.mockResolvedValue(clientLimits("allowed"))
    mocks.getActivePageByMetaPageId.mockResolvedValue(null)
    mocks.exchangeCodeForInstagramToken.mockResolvedValue({
      accessToken: "token-1",
      expiresAt: null,
    })
    mocks.fetchInstagramProfile.mockResolvedValue({
      igUserId: IG_USER_ID,
      username: "cuenta_cliente",
      name: "Cuenta",
    })
    mocks.subscribeInstagramWebhook.mockResolvedValue(undefined)
    mocks.connectInstagramAccount.mockResolvedValue({
      id: "connection-1",
      tenantId: "tenant-1",
      channel: "instagram",
      metaPageId: IG_USER_ID,
      username: "cuenta_cliente",
    })
  })

  it("connects into the parent's tenant tagged with the client account", async () => {
    const response = await GET(callbackRequest())

    expect(mocks.getClientLimits).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      clientAccountId: "client-1",
    })
    // El permiso de canal es del tenant, no del user del cliente.
    expect(mocks.resolveInstagramAccess).toHaveBeenCalledWith("tenant-1")
    expect(mocks.connectInstagramAccount).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ igUserId: IG_USER_ID }),
      "client-1"
    )
    // El cupo del plan no se lee aparte: viene dentro de `client-limits`.
    expect(mocks.countActivePages).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toContain("instagram=connected")
  })

  it("bounces with the client's own verdict as the reason", async () => {
    mocks.getClientLimits.mockResolvedValue(clientLimits("client_limit_reached"))

    const response = await GET(callbackRequest())

    expect(reasonOf(response)).toBe("client_limit_reached")
    expect(mocks.connectInstagramAccount).not.toHaveBeenCalled()
    expect(mocks.subscribeInstagramWebhook).not.toHaveBeenCalled()
  })

  it("bounces with the parent's global limit as the reason", async () => {
    mocks.getClientLimits.mockResolvedValue(clientLimits("tenant_limit_reached"))

    const response = await GET(callbackRequest())

    expect(reasonOf(response)).toBe("tenant_limit_reached")
    expect(mocks.connectInstagramAccount).not.toHaveBeenCalled()
  })

  // La reconexión de una cuenta ya activa del tenant sigue sin pedir hueco.
  it("still lets a reconnection through at the cap", async () => {
    mocks.getClientLimits.mockResolvedValue(clientLimits("client_limit_reached"))
    mocks.getActivePageByMetaPageId.mockResolvedValue({
      id: "connection-1",
      tenantId: "tenant-1",
      metaPageId: IG_USER_ID,
    })

    const response = await GET(callbackRequest())

    expect(mocks.connectInstagramAccount).toHaveBeenCalledTimes(1)
    expect(response.headers.get("location")).toContain("instagram=connected")
  })

  it("fails closed before the exchange when the limits cannot be read", async () => {
    mocks.getClientLimits.mockResolvedValue({
      ok: false,
      reason: "plan_unresolved",
    })

    const response = await GET(callbackRequest())

    expect(reasonOf(response)).toBe("configuration_failed")
    expect(mocks.exchangeCodeForInstagramToken).not.toHaveBeenCalled()
  })
})
