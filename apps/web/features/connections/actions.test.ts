import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  disconnectPage: vi.fn(),
  getActivePageWithTokenByConnectionId: vi.fn(),
  getGeneratedWhatsappPin: vi.fn(),
  revalidatePath: vi.fn(),
  unsubscribeChannelWebhook: vi.fn(),
  updatePageWebhookUrl: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}))

// Se mockea el despachador por canal y no `@/lib/meta`: la acción ya no elige
// el endpoint, lo elige `channel-webhook` a partir del canal de la fila.
vi.mock("@/lib/pages/channel-webhook", () => ({
  unsubscribeChannelWebhook: mocks.unsubscribeChannelWebhook,
}))

vi.mock("@/lib/pages/page-registry", () => {
  class InvalidWebhookUrlError extends Error {}

  return {
    disconnectPage: mocks.disconnectPage,
    getActivePageWithTokenByConnectionId:
      mocks.getActivePageWithTokenByConnectionId,
    getGeneratedWhatsappPin: mocks.getGeneratedWhatsappPin,
    InvalidWebhookUrlError,
    updatePageWebhookUrl: mocks.updatePageWebhookUrl,
  }
})

vi.mock("@/lib/posthog", () => ({
  posthog: null,
}))

import { InvalidWebhookUrlError } from "@/lib/pages/page-registry"

import {
  disconnectPageAction,
  revealWhatsappPinAction,
  saveWebhookUrlAction,
} from "./actions"

describe("disconnectPageAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.disconnectPage.mockResolvedValue({
      id: "connection-1",
      metaPageId: "meta-page-1",
    })
    mocks.unsubscribeChannelWebhook.mockResolvedValue(true)
  })

  it("disconnects locally and unsubscribes the active page from Meta", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: { channel: "messenger", metaPageId: "meta-page-1", wabaId: null },
      pageAccessToken: "page-token",
    })

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      message: "Página desconectada. El historial se conserva.",
    })

    expect(mocks.getActivePageWithTokenByConnectionId).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1"
    )
    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1"
    )
    expect(mocks.unsubscribeChannelWebhook).toHaveBeenCalledWith({
      channel: "messenger",
      metaPageId: "meta-page-1",
      accessToken: "page-token",
      wabaId: null,
      excludeConnectionIds: ["connection-1"],
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
  })

  // El canal viaja desde la fila hasta el despachador: si la acción lo perdiera
  // por el camino, una cuenta de Instagram se desuscribiría contra el Graph de
  // Facebook y seguiría recibiendo eventos.
  it("passes the Instagram channel through to the unsubscribe dispatcher", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: {
        channel: "instagram",
        metaPageId: "17841400000000000",
        wabaId: null,
      },
      pageAccessToken: "ig-token",
    })

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await disconnectPageAction({}, formData)

    expect(mocks.unsubscribeChannelWebhook).toHaveBeenCalledWith({
      channel: "instagram",
      metaPageId: "17841400000000000",
      accessToken: "ig-token",
      wabaId: null,
      excludeConnectionIds: ["connection-1"],
    })
  })

  // En WhatsApp la suscripción cuelga del WABA y no del número, así que el
  // canal no alcanza: si la acción perdiera el `wabaId` por el camino, el
  // despachador se negaría a llamar y el número seguiría recibiendo mensajes de
  // un tenant que ya lo desconectó.
  it("passes the WhatsApp WABA id through to the unsubscribe dispatcher", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: {
        channel: "whatsapp",
        metaPageId: "109876543210987",
        wabaId: "102030405060708",
      },
      pageAccessToken: "wa-token",
    })

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await disconnectPageAction({}, formData)

    // El id de la conexión que se está dando de baja viaja hasta el
    // despachador: es lo que le permite preguntar «¿al WABA le quedan otros
    // números activos **además de este**?» en vez de desuscribirlo siempre y
    // apagarle los webhooks a los demás números de la misma cuenta.
    expect(mocks.unsubscribeChannelWebhook).toHaveBeenCalledWith({
      channel: "whatsapp",
      metaPageId: "109876543210987",
      accessToken: "wa-token",
      wabaId: "102030405060708",
      excludeConnectionIds: ["connection-1"],
    })
  })

  it("does not block local disconnect when Meta unsubscribe fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: { channel: "messenger", metaPageId: "meta-page-1", wabaId: null },
      pageAccessToken: "page-token",
    })
    mocks.unsubscribeChannelWebhook.mockRejectedValue(new Error("Meta is down"))

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      message: "Página desconectada. El historial se conserva.",
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
      message: "Página desconectada. El historial se conserva.",
    })

    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1"
    )
    expect(mocks.unsubscribeChannelWebhook).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")

    consoleError.mockRestore()
  })

  it("skips Meta unsubscribe when there is no active page token", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue(null)

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      message: "Página desconectada. El historial se conserva.",
    })

    expect(mocks.unsubscribeChannelWebhook).not.toHaveBeenCalled()
  })

  // Estados de la acción en español (ADR 0005): son el texto que se pinta
  // debajo del botón, no logs.
  it("answers in Spanish when the session or the page id are missing", async () => {
    mocks.auth.mockResolvedValue(null)
    await expect(disconnectPageAction({}, new FormData())).resolves.toEqual({
      error: "No has iniciado sesión.",
    })

    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    await expect(disconnectPageAction({}, new FormData())).resolves.toEqual({
      error: "Página inválida.",
    })

    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue(null)
    mocks.disconnectPage.mockResolvedValue(null)
    const formData = new FormData()
    formData.set("connectionId", "connection-1")
    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      error: "No encontramos esa página.",
    })
  })
})

describe("saveWebhookUrlAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.updatePageWebhookUrl.mockResolvedValue({
      id: "connection-1",
      metaPageId: "meta-page-1",
    })
  })

  const webhookForm = (webhookUrl: string, connectionId = "connection-1") => {
    const formData = new FormData()
    formData.set("connectionId", connectionId)
    formData.set("webhookUrl", webhookUrl)
    return formData
  }

  it("confirms the saved webhook in Spanish", async () => {
    await expect(
      saveWebhookUrlAction({}, webhookForm("https://hooks.vetta.app/resender"))
    ).resolves.toEqual({ message: "Webhook actualizado." })

    expect(mocks.updatePageWebhookUrl).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1",
      "https://hooks.vetta.app/resender"
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
  })

  it("propagates the rule that the domain module already states in Spanish", async () => {
    mocks.updatePageWebhookUrl.mockRejectedValue(
      new InvalidWebhookUrlError("La URL tiene que usar https.")
    )

    await expect(
      saveWebhookUrlAction({}, webhookForm("http://localhost:5678/webhook"))
    ).resolves.toEqual({ error: "La URL tiene que usar https." })

    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("re-throws anything that is not a webhook URL error", async () => {
    mocks.updatePageWebhookUrl.mockRejectedValue(new Error("connection lost"))

    await expect(
      saveWebhookUrlAction({}, webhookForm("https://hooks.vetta.app/resender"))
    ).rejects.toThrow("connection lost")
  })

  it("answers in Spanish when the session, the page id or the page are missing", async () => {
    mocks.auth.mockResolvedValue(null)
    await expect(saveWebhookUrlAction({}, new FormData())).resolves.toEqual({
      error: "No has iniciado sesión.",
    })

    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    await expect(saveWebhookUrlAction({}, new FormData())).resolves.toEqual({
      error: "Página inválida.",
    })

    mocks.updatePageWebhookUrl.mockResolvedValue(null)
    await expect(
      saveWebhookUrlAction({}, webhookForm("https://hooks.vetta.app/resender"))
    ).resolves.toEqual({ error: "No encontramos esa página." })
  })
})

// El PIN es una credencial del número del cliente que custodiamos porque Meta
// no la vuelve a mostrar (migración 0016). Se lee con una acción y no como dato
// de la pantalla: así no viaja en el render de Conexiones, sino una vez y
// cuando alguien lo pide.
describe("revealWhatsappPinAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  const pinForm = (connectionId = "connection-1") => {
    const formData = new FormData()
    formData.set("connectionId", connectionId)
    return formData
  }

  it("returns the PIN we generated for this tenant's number", async () => {
    mocks.getGeneratedWhatsappPin.mockResolvedValue("042713")

    await expect(revealWhatsappPinAction({}, pinForm())).resolves.toEqual({
      pin: "042713",
    })

    expect(mocks.getGeneratedWhatsappPin).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1"
    )
  })

  // La consulta filtra por tenant y por «lo generamos nosotros», así que acá los
  // dos casos llegan igual: sin PIN. El mensaje no distingue si el número no es
  // suyo o si el PIN es del cliente, porque la primera diferencia sería un
  // oráculo de qué números existen.
  it("says nothing useful when there is no PIN of ours to hand back", async () => {
    mocks.getGeneratedWhatsappPin.mockResolvedValue(null)

    const result = await revealWhatsappPinAction({}, pinForm())

    expect(result.pin).toBeUndefined()
    expect(result.error).toContain("No tenemos un PIN guardado")
  })

  it("never lets the PIN out without a session", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(revealWhatsappPinAction({}, pinForm())).resolves.toEqual({
      error: "No has iniciado sesión.",
    })
    expect(mocks.getGeneratedWhatsappPin).not.toHaveBeenCalled()
  })

  it("answers in Spanish when the connection id is missing", async () => {
    await expect(
      revealWhatsappPinAction({}, new FormData())
    ).resolves.toEqual({ error: "Número inválido." })
    expect(mocks.getGeneratedWhatsappPin).not.toHaveBeenCalled()
  })

  // El descifrado puede fallar (clave rotada, fila corrupta). Ni el error ni el
  // log pueden llevar el PIN dentro.
  it("does not leak anything when decryption fails", async () => {
    const lines: unknown[][] = []
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args)
    })
    mocks.getGeneratedWhatsappPin.mockRejectedValue(
      new Error("invalid encrypted payload")
    )

    const result = await revealWhatsappPinAction({}, pinForm())

    expect(result.pin).toBeUndefined()
    expect(result.error).toContain("No pudimos leer el PIN")
    expect(lines[0]?.[0]).toMatchObject({
      action: "token_decrypt",
      outcome: "failed",
      channel: "whatsapp",
      connectionId: "connection-1",
    })
  })
})
