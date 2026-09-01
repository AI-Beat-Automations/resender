import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getSession: vi.fn(),
  connectAuthorizedPages: vi.fn(),
  countActivePages: vi.fn(),
  getMetaUserAccessToken: vi.fn(),
  getPageOwnership: vi.fn(),
  getSubscriptionByTenantId: vi.fn(),
  hasActiveSubscription: vi.fn(),
  isUserWaitlisted: vi.fn(),
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

vi.mock("@/lib/auth/waitlist", () => ({
  isUserWaitlisted: mocks.isUserWaitlisted,
}))

vi.mock("@/lib/billing/subscription", () => ({
  getSubscriptionByTenantId: mocks.getSubscriptionByTenantId,
  hasActiveSubscription: mocks.hasActiveSubscription,
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
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.getMetaUserAccessToken.mockResolvedValue("user-token")
    mocks.listAuthorizedPages.mockResolvedValue([
      authorizedPage("page-1"),
      authorizedPage("page-2"),
      authorizedPage("page-3"),
    ])
    mocks.getSubscriptionByTenantId.mockResolvedValue({
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
    expect(mocks.connectAuthorizedPages).toHaveBeenCalledWith("tenant-1", [
      authorizedPage("page-2"),
    ])
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
  it("blocks a tenant without an active subscription", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result).toEqual({ error: "Tu suscripción no está activa." })
    expect(mocks.getMetaUserAccessToken).not.toHaveBeenCalled()
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  it("blocks a waitlisted tenant", async () => {
    mocks.isUserWaitlisted.mockResolvedValue(true)

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result).toEqual({ error: "Tu cuenta está en la lista de espera." })
    expect(mocks.getMetaUserAccessToken).not.toHaveBeenCalled()
  })
})
