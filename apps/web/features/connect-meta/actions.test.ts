import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
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

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/auth", () => ({
  auth: mocks.auth,
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
  class WebhookSubscriptionError extends Error {}

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
  class PageOwnershipError extends Error {}

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
    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
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

  it("rejects a selection that exceeds the remaining slots of the plan", async () => {
    mocks.countActivePages.mockResolvedValue(1)

    const result = await connectSelectedPagesAction(
      {},
      selection("page-1", "page-2")
    )

    expect(result.error).toContain("2 connected Pages")
    expect(mocks.subscribePagesToWebhook).not.toHaveBeenCalled()
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  it("rejects a Page owned by another tenant without touching the rest", async () => {
    mocks.getPageOwnership.mockResolvedValue([
      { metaPageId: "page-1", tenantId: "tenant-2", status: "active" },
    ])

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result.error).toBe(
      "That selection includes a Page you can't connect. Reload the page and try again."
    )
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  it("sends the user back through the Meta dialog when the stored token is gone", async () => {
    mocks.getMetaUserAccessToken.mockResolvedValue(null)

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result).toEqual({
      error: "Your Meta authorization expired. Connect Facebook again.",
    })
    expect(mocks.listAuthorizedPages).not.toHaveBeenCalled()
  })

  // La action se puede invocar por POST directo, sin pasar por el layout de
  // `(product)`: los gates tienen que estar acá también.
  it("blocks a tenant without an active subscription", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false)

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result).toEqual({ error: "Your subscription isn't active." })
    expect(mocks.getMetaUserAccessToken).not.toHaveBeenCalled()
    expect(mocks.connectAuthorizedPages).not.toHaveBeenCalled()
  })

  it("blocks a waitlisted tenant", async () => {
    mocks.isUserWaitlisted.mockResolvedValue(true)

    const result = await connectSelectedPagesAction({}, selection("page-1"))

    expect(result).toEqual({ error: "Your account is on the waitlist." })
    expect(mocks.getMetaUserAccessToken).not.toHaveBeenCalled()
  })
})
