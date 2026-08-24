import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  unsubscribeFromWebhook: vi.fn(),
  unsubscribeInstagramWebhook: vi.fn(),
  countActiveWhatsappNumbersInWaba: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/meta", () => ({
  unsubscribeFromWebhook: mocks.unsubscribeFromWebhook,
}))

vi.mock("@/lib/instagram", () => ({
  unsubscribeInstagramWebhook: mocks.unsubscribeInstagramWebhook,
}))

vi.mock("@/lib/observability/logger", () => ({ log: mocks.log }))

vi.mock("./page-registry", () => ({
  countActiveWhatsappNumbersInWaba: mocks.countActiveWhatsappNumbersInWaba,
}))

import { unsubscribeChannelWebhook } from "./channel-webhook"

describe("desuscripción del webhook por canal", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.unsubscribeFromWebhook.mockResolvedValue(true)
    mocks.unsubscribeInstagramWebhook.mockResolvedValue(true)
    mocks.countActiveWhatsappNumbersInWaba.mockResolvedValue(0)
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
      "page-token",
      "messenger"
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

  // ------------------------------------------------------------------
  // WhatsApp: se conecta un número y se suscribe el WABA
  // ------------------------------------------------------------------

  // El bug que este switch existe para no repetir: con el ternario binario,
  // WhatsApp caía en la rama de Messenger y le pedía a Graph que desuscribiera
  // el `phone_number_id`, que no es un nodo con `subscribed_apps`.
  it("manda WhatsApp al Graph de Facebook con el WABA, no con el número", async () => {
    await expect(
      unsubscribeChannelWebhook({
        channel: "whatsapp",
        metaPageId: "1555550001",
        accessToken: "wa-token",
        wabaId: "waba-1",
      })
    ).resolves.toBe(true)

    expect(mocks.unsubscribeFromWebhook).toHaveBeenCalledWith(
      "waba-1",
      "wa-token",
      "whatsapp"
    )
  })

  // Desuscribir el WABA apagaría los webhooks de los demás números de esa
  // cuenta —incluidos los de otro tenant— sin ningún error visible.
  it("no desuscribe si al WABA le quedan números activos", async () => {
    mocks.countActiveWhatsappNumbersInWaba.mockResolvedValue(2)

    await expect(
      unsubscribeChannelWebhook({
        channel: "whatsapp",
        metaPageId: "1555550001",
        accessToken: "wa-token",
        wabaId: "waba-1",
      })
    ).resolves.toBe(true)

    expect(mocks.unsubscribeFromWebhook).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "skipped",
        reason: "waba_has_active_numbers",
        remainingConnections: 2,
      })
    )
  })

  // La conexión que se está dando de baja no cuenta como «todavía activa».
  it("excluye del conteo las conexiones que se están dando de baja", async () => {
    await unsubscribeChannelWebhook({
      channel: "whatsapp",
      metaPageId: "1555550001",
      accessToken: "wa-token",
      wabaId: "waba-1",
      excludeConnectionIds: ["conn-1"],
    })

    expect(mocks.countActiveWhatsappNumbersInWaba).toHaveBeenCalledWith({
      wabaId: "waba-1",
      excludeConnectionIds: ["conn-1"],
    })
  })

  // Sin WABA no hay desuscripción posible, y fingirla mandando el número por el
  // camino de Messenger es peor que decir que no se pudo.
  it("falla ruidoso y sin llamar a nadie cuando falta el WABA", async () => {
    await expect(
      unsubscribeChannelWebhook({
        channel: "whatsapp",
        metaPageId: "1555550001",
        accessToken: "wa-token",
        wabaId: null,
      })
    ).resolves.toBe(false)

    expect(mocks.unsubscribeFromWebhook).not.toHaveBeenCalled()
    expect(mocks.countActiveWhatsappNumbersInWaba).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        reason: "missing_waba_id",
      })
    )
  })
})
