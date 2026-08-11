import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  unsubscribeFromWebhook: vi.fn(),
  unsubscribeInstagramWebhook: vi.fn(),
}))

vi.mock("@/lib/meta", () => ({
  unsubscribeFromWebhook: mocks.unsubscribeFromWebhook,
}))

vi.mock("@/lib/instagram", () => ({
  unsubscribeInstagramWebhook: mocks.unsubscribeInstagramWebhook,
}))

import { unsubscribeChannelWebhook } from "./channel-webhook"

describe("desuscripción del webhook por canal", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.unsubscribeFromWebhook.mockResolvedValue(true)
    mocks.unsubscribeInstagramWebhook.mockResolvedValue(true)
  })

  // Messenger necesita el page id en el path; Instagram no lo acepta.
  it("manda Messenger al Graph de Facebook con el page id", async () => {
    await expect(
      unsubscribeChannelWebhook({
        channel: "messenger",
        metaPageId: "meta-page-1",
        accessToken: "page-token",
      })
    ).resolves.toBe(true)

    expect(mocks.unsubscribeFromWebhook).toHaveBeenCalledWith(
      "meta-page-1",
      "page-token"
    )
    expect(mocks.unsubscribeInstagramWebhook).not.toHaveBeenCalled()
  })

  // El token de la cuenta ya la identifica: mandar el IG ID al Graph de
  // Facebook da un 400 que se registra como «Meta no confirmó» y deja la cuenta
  // recibiendo eventos.
  it("manda Instagram a /me con el token de la cuenta y sin id", async () => {
    await expect(
      unsubscribeChannelWebhook({
        channel: "instagram",
        metaPageId: "17841400000000000",
        accessToken: "ig-token",
      })
    ).resolves.toBe(true)

    expect(mocks.unsubscribeInstagramWebhook).toHaveBeenCalledWith("ig-token")
    expect(mocks.unsubscribeFromWebhook).not.toHaveBeenCalled()
  })

  it("propaga que Meta no confirmó, sin lanzar", async () => {
    mocks.unsubscribeInstagramWebhook.mockResolvedValue(false)

    await expect(
      unsubscribeChannelWebhook({
        channel: "instagram",
        metaPageId: "178414",
        accessToken: "ig-token",
      })
    ).resolves.toBe(false)
  })
})
