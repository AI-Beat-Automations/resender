import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  disconnectPage: vi.fn(),
  getActivePageWithTokenByConnectionId: vi.fn(),
  revalidatePath: vi.fn(),
  unsubscribeFromWebhook: vi.fn(),
  updatePageWebhookUrl: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}))

vi.mock("@/lib/meta", () => ({
  unsubscribeFromWebhook: mocks.unsubscribeFromWebhook,
}))

vi.mock("@/lib/pages/page-registry", () => {
  class InvalidWebhookUrlError extends Error {}

  return {
    disconnectPage: mocks.disconnectPage,
    getActivePageWithTokenByConnectionId:
      mocks.getActivePageWithTokenByConnectionId,
    InvalidWebhookUrlError,
    updatePageWebhookUrl: mocks.updatePageWebhookUrl,
  }
})

import { disconnectPageAction } from "./actions"

describe("disconnectPageAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.disconnectPage.mockResolvedValue({
      id: "connection-1",
      metaPageId: "meta-page-1",
    })
    mocks.unsubscribeFromWebhook.mockResolvedValue(true)
  })

  it("disconnects locally and unsubscribes the active page from Meta", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: { metaPageId: "meta-page-1" },
      pageAccessToken: "page-token",
    })

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      message: "Page disconnected. The history is kept.",
    })

    expect(mocks.getActivePageWithTokenByConnectionId).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1"
    )
    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1"
    )
    expect(mocks.unsubscribeFromWebhook).toHaveBeenCalledWith(
      "meta-page-1",
      "page-token"
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
  })

  it("does not block local disconnect when Meta unsubscribe fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: { metaPageId: "meta-page-1" },
      pageAccessToken: "page-token",
    })
    mocks.unsubscribeFromWebhook.mockRejectedValue(new Error("Meta is down"))

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      message: "Page disconnected. The history is kept.",
    })

    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1"
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")

    consoleError.mockRestore()
  })

  it("does not block local disconnect when loading the Meta unsubscribe context fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.getActivePageWithTokenByConnectionId.mockRejectedValue(
      new Error("cannot decrypt token")
    )

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      message: "Page disconnected. The history is kept.",
    })

    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1"
    )
    expect(mocks.unsubscribeFromWebhook).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")

    consoleError.mockRestore()
  })

  it("skips Meta unsubscribe when there is no active page token", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue(null)

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      message: "Page disconnected. The history is kept.",
    })

    expect(mocks.unsubscribeFromWebhook).not.toHaveBeenCalled()
  })
})
