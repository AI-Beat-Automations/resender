import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getSession: vi.fn(),
  connectAuthorizedPages: vi.fn(),
  countActivePages: vi.fn(),
  getMetaUserAccessToken: vi.fn(),
  getPageOwnership: vi.fn(),
  getSubscriptionByTenantId: vi.fn(),
  resolveConnectGate: vi.fn(),
  getClientLimits: vi.fn(),
  listAuthorizedPages: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  subscribePagesToWebhook: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

// El idioma de la acción sale de la cookie `lang`; sin cookie cae en español,
// que es el idioma de las aserciones de abajo.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.getSession,
}))

// Los gates van por actor (issue #154): el padre y el cliente entran por el
// mismo resolutor, y lo que cambia es con qué tenant y qué tope se conecta.
vi.mock("@/lib/clients/connect-gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clients/connect-gate")>()),
  resolveConnectGate: mocks.resolveConnectGate,
}))

vi.mock("@/lib/clients/client-limits-status", () => ({
  getClientLimits: mocks.getClientLimits,
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

vi.mock("@/lib/meta", () => {
  class WebhookSubscriptionError extends Error {
    constructor(readonly failedPageIds: string[]) {
      super("webhook subscription failed")
    }
  }

  return {
    listAuthorizedPages: mocks.listAuthorizedPages,
    subscribePagesToWebhook: mocks.subscribePagesToWebhook,
    WebhookSubscriptionError,
  }
})

vi.mock("@/lib/pages/meta-user-token", () => ({
  getMetaUserAccessToken: mocks.getMetaUserAccessToken,
}))

vi.mock("@/lib/pages/page-registry", () => {
  class PageOwnershipError extends Error {
    constructor(readonly metaPageId: string) {
      super("page already belongs to another tenant")
    }
  }

  return {
    connectAuthorizedPages: mocks.connectAuthorizedPages,
    countActivePages: mocks.countActivePages,
    getPageOwnership: mocks.getPageOwnership,
    PageOwnershipError,
  }
})

vi.mock("@/lib/posthog", () => ({
  posthog: null,
}))

import { WebhookSubscriptionError } from "@/lib/meta"
import { PageOwnershipError } from "@/lib/pages/page-registry"

import { connectSelectedPagesAction } from "./actions"

const authorizedPage = (pageId: string) => ({
  pageId,
  name: `Page ${pageId}`,
  pageAccessToken: `token-${pageId}`,
})

const PARENT = {
  tenantId: "tenant-1",
  userId: "tenant-1",
  clientAccountId: null,
}
const CLIENT = {
  tenantId: "tenant-1",
  userId: "user-2",
  clientAccountId: "client-1",
}

const selection = (...pageIds: string[]) => {
  const formData = new FormData()
  for (const pageId of pageIds) formData.append("pageIds", pageId)
  return formData
}

describe("connectSelectedPagesAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveConnectGate.mockResolvedValue({ kind: "ok", actor: PARENT })
    mocks.getMetaUserAccessToken.mockResolvedValue("user-token")
    mocks.listAuthorizedPages.mockResolvedValue([
      authorizedPage("page-1"),
      authorizedPage("page-2"),
      authorizedPage("page-3"),
    ])
    mocks.getSubscriptionByTenantId.mockResolvedValue({
      status: "active",
      priceLookupKey: "starter_monthly",
    })
    mocks.countActivePages.mockResolvedValue(0)
    mocks.getPageOwnership.mockResolvedValue([])
    mocks.subscribePagesToWebhook.mockResolvedValue(undefined)
  })

  it("connects only the selected subset of Pages", async () => {
    mocks.connectAuthorizedPages.mockResolvedValue([
      { metaPageId: "page-2", name: "Page page-2" },
    ])

    await connectSelectedPagesAction({}, selection("page-2"))

    expect(mocks.subscribePagesToWebhook).toHaveBeenCalledWith([
      authorizedPage("page-2"),
    ])
    // El padre conecta sin `client_account_id`: la fila es suya.
    expect(mocks.connectAuthorizedPages).toHaveBeenCalledWith(
      "tenant-1",
      [authorizedPage("page-2")],
      null
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/connections?meta=connected&pages=${encodeURIComponent(
        JSON.stringify([{ id: "page-2", name: "Page page-2" }])
      )}`
    )
  })

  // Los fallos de Meta se redactan desde `lib/pages/meta-connection-error`,
  // igual que los del callback (ADR 0005).
  it("reuses the shared Spanish copy for the Meta failures", async () => {
    mocks.subscribePagesToWebhook.mockRejectedValue(
      new WebhookSubscriptionError(["page-1"])
    )

    await expect(
      connectSelectedPagesAction({}, selection("page-1"))
    ).resolves.toEqual({
      error:
        "No se pudo conectar: Meta no confirmó la suscripción al webhook de todas las páginas. Ninguna página quedó guardada.",
    })

    mocks.subscribePagesToWebhook.mockResolvedValue(undefined)
    mocks.connectAuthorizedPages.mockRejectedValue(
      new PageOwnershipError("page-1")
    )

    await expect(
      connectSelectedPagesAction({}, selection("page-1"))
    ).resolves.toEqual({
      error:
        "No se pudo conectar: la página page-1 ya pertenece a otra cuenta de Resender.",
    })
  })

  // El cupo que devuelve `countActivePages` cuenta **todas** las conexiones
  // activas del tenant, no solo las Páginas (ADR 0011): esa 1 activa puede ser
  // una cuenta de Instagram que esta pantalla ni siquiera lista.
  it("rejects a selection that exceeds the remaining slots of the plan", async () => {
    mocks.countActivePages.mockResolvedValue(1)

    const result = await connectSelectedPagesAction(
      {},
      selection("page-1", "page-2")
    )

    expect(result.error).toBe(
      "Tu plan permite 2 conexiones y ya tienes 1 activas: puedes añadir 1 página más. Desmarca las que sobren o desconecta una página para liberar cupo."
    )
    expect(mocks.subscribePagesToWebhook).not.toHaveBeenCalled()
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  it("rejects a Page owned by another tenant without touching the rest", async () => {
    mocks.getPageOwnership.mockResolvedValue([
      { metaPageId: "page-1", tenantId: "tenant-2", status: "active" },
    ])

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result.error).toBe(
      "Esa selección incluye una página que no puedes conectar. Recarga la pantalla e inténtalo de nuevo."
    )
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  it("sends the user back through the Meta dialog when the stored token is gone", async () => {
    mocks.getMetaUserAccessToken.mockResolvedValue(null)

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result).toEqual({
      error:
        "No se pudo conectar: tu autorización de Meta venció. Vuelve a conectar Facebook.",
    })
    expect(mocks.listAuthorizedPages).not.toHaveBeenCalled()
  })

  // La action se puede invocar por POST directo, sin pasar por el layout de
  // `(product)`: los gates tienen que estar acá también.
  it("blocks an owner whose email is not confirmed", async () => {
    mocks.resolveConnectGate.mockResolvedValue({ kind: "email_unverified" })

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result).toEqual({
      error: "Confirma tu correo antes de conectar una red.",
    })
    expect(mocks.getMetaUserAccessToken).not.toHaveBeenCalled()
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  // El cliente cuyo padre dejó de pagar no ve vocabulario de facturación.
  it("tells a restricted client that its access is paused, never the subscription", async () => {
    mocks.resolveConnectGate.mockResolvedValue({ kind: "client_restricted" })

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result).toEqual({
      error: "Tu acceso está en pausa. Contacta a quien administra tu acceso.",
    })
    expect(result.error).not.toMatch(/suscripci/i)
  })

  it("blocks a waitlisted tenant", async () => {
    mocks.resolveConnectGate.mockResolvedValue({ kind: "waitlisted" })

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result).toEqual({ error: "Tu cuenta está en la lista de espera." })
    expect(mocks.getMetaUserAccessToken).not.toHaveBeenCalled()
  })
})

// Conectar como cliente (issue #154, ticket 3): la fila va al tenant del padre
// con el `client_account_id` del cliente, el token de Meta es el del user del
// cliente, y el cupo es el de `client-limits`.
describe("connectSelectedPagesAction as a client", () => {
  const clientLimits = (overrides = {}) => ({
    ok: true,
    ownerName: "Agencia Norte",
    limits: {
      verdict: "allowed",
      remainingSlots: 1,
      nearLimit: true,
      clientMaxConnections: 2,
      clientActiveCount: 1,
      planMaxPages: 5,
      tenantActiveCount: 3,
      ...overrides,
    },
  })

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "user-2" } })
    mocks.resolveConnectGate.mockResolvedValue({ kind: "ok", actor: CLIENT })
    mocks.getMetaUserAccessToken.mockResolvedValue("client-user-token")
    mocks.listAuthorizedPages.mockResolvedValue([
      authorizedPage("page-1"),
      authorizedPage("page-2"),
    ])
    mocks.getPageOwnership.mockResolvedValue([])
    mocks.getClientLimits.mockResolvedValue(clientLimits())
    mocks.subscribePagesToWebhook.mockResolvedValue(undefined)
    mocks.connectAuthorizedPages.mockImplementation(
      async (_tenantId: string, pages: { pageId: string; name: string }[]) =>
        pages.map((page) => ({
          id: `connection-${page.pageId}`,
          tenantId: "tenant-1",
          metaPageId: page.pageId,
          name: page.name,
        }))
    )
  })

  it("writes the row in the parent's tenant tagged with the client account", async () => {
    await connectSelectedPagesAction({}, selection("page-1"))

    // El token de Meta es el del user del cliente: fue él quien se logueó.
    expect(mocks.getMetaUserAccessToken).toHaveBeenCalledWith("user-2")
    expect(mocks.getClientLimits).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      clientAccountId: "client-1",
    })
    expect(mocks.connectAuthorizedPages).toHaveBeenCalledWith(
      "tenant-1",
      [authorizedPage("page-1")],
      "client-1"
    )
    // El cupo del plan no se lee aparte: ya viene dentro de `client-limits`.
    expect(mocks.getSubscriptionByTenantId).not.toHaveBeenCalled()
    expect(mocks.countActivePages).not.toHaveBeenCalled()
  })

  it("rejects the client at its own cap naming the parent, never the plan", async () => {
    mocks.getClientLimits.mockResolvedValue(
      clientLimits({
        verdict: "client_limit_reached",
        remainingSlots: 0,
        clientActiveCount: 2,
      })
    )

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result.error).toContain("Agencia Norte")
    expect(result.error).not.toMatch(/plan/i)
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  it("rejects the client when the parent's global limit is full", async () => {
    mocks.getClientLimits.mockResolvedValue(
      clientLimits({ verdict: "tenant_limit_reached", remainingSlots: 0 })
    )

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result.error).toContain("Agencia Norte")
    expect(result.error).not.toMatch(/plan/i)
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  it("caps the selection to the slots the client really has", async () => {
    const result = await connectSelectedPagesAction(
      {},
      selection("page-1", "page-2")
    )

    expect(result.error).toContain("1")
    expect(result.error).not.toMatch(/plan/i)
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  it("fails closed without naming the plan when the limits cannot be read", async () => {
    mocks.getClientLimits.mockResolvedValue({
      ok: false,
      reason: "plan_unresolved",
    })

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result.error).not.toMatch(/plan/i)
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })
})
