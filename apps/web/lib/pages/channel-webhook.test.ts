import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  countActiveWhatsappNumbersInWaba: vi.fn(),
  unsubscribeFromWebhook: vi.fn(),
  unsubscribeInstagramWebhook: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/meta", () => ({
  unsubscribeFromWebhook: mocks.unsubscribeFromWebhook,
}))

vi.mock("@/lib/instagram", () => ({
  unsubscribeInstagramWebhook: mocks.unsubscribeInstagramWebhook,
}))

vi.mock("@/lib/observability/logger", () => ({
  log: mocks.log,
}))

vi.mock("./page-registry", () => ({
  countActiveWhatsappNumbersInWaba: mocks.countActiveWhatsappNumbersInWaba,
}))

import { unsubscribeChannelWebhook } from "./channel-webhook"

describe("desuscripción del webhook por canal", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.unsubscribeFromWebhook.mockResolvedValue(true)
    mocks.unsubscribeInstagramWebhook.mockResolvedValue(true)
    // Por defecto, el número que se desconecta es el último del WABA.
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

  // El bug que este canal habría repetido: con un ternario binario, WhatsApp
  // caía en la rama de Messenger y desuscribía el `phone_number_id`, que no es
  // el nodo del que cuelga la suscripción. Acá se afirma el id que viaja, no
  // solo que se llamó al endpoint.
  it("manda WhatsApp al Graph de Facebook con el WABA y no con el número", async () => {
    await expect(
      unsubscribeChannelWebhook({
        channel: "whatsapp",
        metaPageId: "109876543210987", // phone_number_id
        accessToken: "wa-token",
        wabaId: "102030405060708",
        excludeConnectionIds: ["connection-1"],
      })
    ).resolves.toBe(true)

    expect(mocks.countActiveWhatsappNumbersInWaba).toHaveBeenCalledWith({
      wabaId: "102030405060708",
      excludeConnectionIds: ["connection-1"],
    })
    // El canal viaja hasta el cliente de Meta: sin él, el fallo de un WABA se
    // registraba como un fallo de Messenger con un id de WhatsApp, que es
    // justo lo que hace invisible este problema en producción.
    expect(mocks.unsubscribeFromWebhook).toHaveBeenCalledWith(
      "102030405060708",
      "wa-token",
      "whatsapp"
    )
    expect(mocks.unsubscribeInstagramWebhook).not.toHaveBeenCalled()
  })

  // El bug de producción que motivó la regla: la unidad de conexión es el
  // número y la de suscripción es la cuenta. Desuscribir el WABA al desconectar
  // uno de sus números apaga los webhooks de todos los demás —del mismo tenant
  // y de cualquier otro— sin un solo error visible.
  it("no toca Meta cuando al WABA le quedan otros números activos", async () => {
    mocks.countActiveWhatsappNumbersInWaba.mockResolvedValue(1)

    await expect(
      unsubscribeChannelWebhook({
        channel: "whatsapp",
        metaPageId: "109876543210987",
        accessToken: "wa-token",
        wabaId: "102030405060708",
        excludeConnectionIds: ["connection-1"],
      })
    ).resolves.toBe(true)

    expect(mocks.unsubscribeFromWebhook).not.toHaveBeenCalled()
    // Y queda registrado: «este número se desconectó y su WABA sigue mandando
    // eventos» tiene que poder contestarse desde el log.
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "webhook_unsubscribe",
        outcome: "skipped",
        reason: "waba_has_active_numbers",
        channel: "whatsapp",
        accountId: "102030405060708",
        count: 1,
      })
    )
  })

  it("desuscribe el WABA cuando el número que se va es el último activo", async () => {
    mocks.countActiveWhatsappNumbersInWaba.mockResolvedValue(0)

    await expect(
      unsubscribeChannelWebhook({
        channel: "whatsapp",
        metaPageId: "109876543210987",
        accessToken: "wa-token",
        wabaId: "102030405060708",
      })
    ).resolves.toBe(true)

    expect(mocks.unsubscribeFromWebhook).toHaveBeenCalledWith(
      "102030405060708",
      "wa-token",
      "whatsapp"
    )
  })

  // Sin WABA no hay desuscripción posible. Lo que importa acá no es que
  // devuelva false, es que **no llame a nadie**: una llamada con el
  // `phone_number_id` se registraría como «Meta no confirmó» y taparía el
  // motivo real detrás de un error de Graph que no tiene nada que ver.
  it("no llama a Meta cuando falta el WABA, y deja el motivo en el log", async () => {
    await expect(
      unsubscribeChannelWebhook({
        channel: "whatsapp",
        metaPageId: "109876543210987",
        accessToken: "wa-token",
        wabaId: null,
      })
    ).resolves.toBe(false)

    expect(mocks.unsubscribeFromWebhook).not.toHaveBeenCalled()
    expect(mocks.unsubscribeInstagramWebhook).not.toHaveBeenCalled()
    // Ni siquiera se pregunta por los números del WABA: sin id no hay nada que
    // contar.
    expect(mocks.countActiveWhatsappNumbersInWaba).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "webhook_unsubscribe",
        outcome: "failed",
        reason: "missing_waba_id",
        channel: "whatsapp",
        accountId: "109876543210987",
      })
    )
  })

  // El `wabaId` es opcional en la firma porque los otros dos canales no lo
  // tienen: omitirlo en WhatsApp tiene que dar el mismo rechazo que pasarlo
  // null, no una llamada con `undefined` en el path.
  it("trata el WABA ausente igual que el WABA null", async () => {
    await expect(
      unsubscribeChannelWebhook({
        channel: "whatsapp",
        metaPageId: "109876543210987",
        accessToken: "wa-token",
      })
    ).resolves.toBe(false)

    expect(mocks.unsubscribeFromWebhook).not.toHaveBeenCalled()
  })

  // Un WABA en una fila de Messenger o de Instagram no puede cambiar el
  // despacho: el canal manda, siempre.
  it("ignora el WABA en los canales que no son WhatsApp", async () => {
    await unsubscribeChannelWebhook({
      channel: "messenger",
      metaPageId: "meta-page-1",
      accessToken: "page-token",
      wabaId: "102030405060708",
    })

    expect(mocks.unsubscribeFromWebhook).toHaveBeenCalledWith(
      "meta-page-1",
      "page-token",
      "messenger"
    )
    expect(mocks.countActiveWhatsappNumbersInWaba).not.toHaveBeenCalled()
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
