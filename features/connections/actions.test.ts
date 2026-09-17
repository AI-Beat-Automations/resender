import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActorByUserId: vi.fn(),
  cookieGet: vi.fn(),
  disconnectPage: vi.fn(),
  setPageForwardingPaused: vi.fn(),
  getActivePageWithTokenByConnectionId: vi.fn(),
  revalidatePath: vi.fn(),
  unsubscribeChannelWebhook: vi.fn(),
  updatePageWebhookUrl: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

// El idioma de la acción sale de la cookie `lang`. Sin store —que es lo que
// devuelve este mock por defecto— cae en español, que es el idioma en el que
// están escritas las aserciones de abajo.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}))

vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.getSession,
}))

// El actor se lee vivo de la base (issue #154): el padre actúa sobre todo el
// tenant y el cliente solo sobre sus filas.
vi.mock("@/lib/clients/actor", () => ({
  resolveActorByUserId: mocks.resolveActorByUserId,
}))

// Se mockea el despachador por canal y no `@/lib/meta`: la acción ya no elige
// el endpoint, lo elige `channel-webhook` a partir del canal de la fila.
vi.mock("@/lib/pages/channel-webhook", () => ({
  unsubscribeChannelWebhook: mocks.unsubscribeChannelWebhook,
}))

vi.mock("@/lib/pages/page-registry", () => {
  // El doble tiene que llevar el `code`, que es lo que la acción traduce.
  class InvalidWebhookUrlError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }

  return {
    disconnectPage: mocks.disconnectPage,
    getActivePageWithTokenByConnectionId:
      mocks.getActivePageWithTokenByConnectionId,
    InvalidWebhookUrlError,
    setPageForwardingPaused: mocks.setPageForwardingPaused,
    updatePageWebhookUrl: mocks.updatePageWebhookUrl,
  }
})

vi.mock("@/lib/posthog", () => ({
  posthog: null,
}))

import { InvalidWebhookUrlError } from "@/lib/pages/page-registry"
import { es } from "@/content/i18n/app/es"

import {
  disconnectPageAction,
  saveWebhookUrlAction,
  setConnectionForwardingPaused,
} from "./actions"

const PARENT = { tenantId: "tenant-1", userId: "tenant-1", clientAccountId: null }
const CLIENT = {
  tenantId: "tenant-1",
  userId: "user-2",
  clientAccountId: "client-1",
}

describe("disconnectPageAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: PARENT })
    mocks.disconnectPage.mockResolvedValue({
      id: "connection-1",
      metaPageId: "meta-page-1",
    })
    mocks.unsubscribeChannelWebhook.mockResolvedValue(true)
  })

  it("disconnects locally and unsubscribes the active page from Meta", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: { channel: "messenger", metaPageId: "meta-page-1" },
      pageAccessToken: "page-token",
    })

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      message: "Página desconectada. El historial se conserva.",
    })

    // El padre actúa sin alcance de cliente: `null` ve todo el tenant.
    expect(mocks.getActivePageWithTokenByConnectionId).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1",
      null
    )
    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1",
      null
    )
    expect(mocks.unsubscribeChannelWebhook).toHaveBeenCalledWith({
      channel: "messenger",
      metaPageId: "meta-page-1",
      accessToken: "page-token",
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
  })

  // El canal viaja desde la fila hasta el despachador: si la acción lo perdiera
  // por el camino, una cuenta de Instagram se desuscribiría contra el Graph de
  // Facebook y seguiría recibiendo eventos.
  it("passes the Instagram channel through to the unsubscribe dispatcher", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: { channel: "instagram", metaPageId: "17841400000000000" },
      pageAccessToken: "ig-token",
    })

    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await disconnectPageAction({}, formData)

    expect(mocks.unsubscribeChannelWebhook).toHaveBeenCalledWith({
      channel: "instagram",
      metaPageId: "17841400000000000",
      accessToken: "ig-token",
    })
  })

  it("does not block local disconnect when Meta unsubscribe fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: { channel: "messenger", metaPageId: "meta-page-1" },
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
      "connection-1",
      null
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
      "connection-1",
      null
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
    mocks.getSession.mockResolvedValue(null)
    await expect(disconnectPageAction({}, new FormData())).resolves.toEqual({
      error: "No has iniciado sesión.",
    })

    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: PARENT })
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
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: PARENT })
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

  it("translates the code that the domain module returns", async () => {
    // El módulo de dominio devuelve un código —lo comparte con la entrega de
    // webhooks, que corre sin idioma—; el texto se resuelve acá.
    mocks.updatePageWebhookUrl.mockRejectedValue(
      new InvalidWebhookUrlError("not_https")
    )

    await expect(
      saveWebhookUrlAction({}, webhookForm("http://localhost:5678/webhook"))
    ).resolves.toEqual({ error: es.actions.webhookUrlNotHttps })

    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("distinguishes a URL that is not https from one that is not a URL", async () => {
    // Es la mitad útil del error: «pon https» y «eso no es una URL» se arreglan
    // distinto.
    mocks.updatePageWebhookUrl.mockRejectedValue(
      new InvalidWebhookUrlError("invalid_url")
    )

    await expect(
      saveWebhookUrlAction({}, webhookForm("no-es-una-url"))
    ).resolves.toEqual({ error: es.actions.webhookUrlInvalid })
  })

  it("re-throws anything that is not a webhook URL error", async () => {
    mocks.updatePageWebhookUrl.mockRejectedValue(new Error("connection lost"))

    await expect(
      saveWebhookUrlAction({}, webhookForm("https://hooks.vetta.app/resender"))
    ).rejects.toThrow("connection lost")
  })

  it("answers in Spanish when the session, the page id or the page are missing", async () => {
    mocks.getSession.mockResolvedValue(null)
    await expect(saveWebhookUrlAction({}, new FormData())).resolves.toEqual({
      error: "No has iniciado sesión.",
    })

    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: PARENT })
    await expect(saveWebhookUrlAction({}, new FormData())).resolves.toEqual({
      error: "Página inválida.",
    })

    mocks.updatePageWebhookUrl.mockResolvedValue(null)
    await expect(
      saveWebhookUrlAction({}, webhookForm("https://hooks.vetta.app/resender"))
    ).resolves.toEqual({ error: "No encontramos esa página." })
  })
})

// Las acciones con actor cliente (issue #154, ticket 3): pausar y desconectar
// van con el alcance de su `client_account_id`, así que una conexión del
// padre o de otro cliente no se encuentra —el registro devuelve `null`— y la
// acción responde lo mismo que para un id inexistente. El webhook y su secreto
// son del padre: al cliente se le rechazan sin tocar la base.
describe("connection actions as a client", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "user-2" } })
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: CLIENT })
    mocks.unsubscribeChannelWebhook.mockResolvedValue(true)
  })

  it("pauses forwarding only within its own connections", async () => {
    mocks.setPageForwardingPaused.mockResolvedValue({
      id: "connection-1",
      metaPageId: "meta-page-1",
      channel: "messenger",
      pausedAt: new Date("2026-07-15T00:00:00Z"),
    })

    await expect(
      setConnectionForwardingPaused("connection-1", true)
    ).resolves.toEqual({ pausedAt: "2026-07-15T00:00:00.000Z" })

    expect(mocks.setPageForwardingPaused).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1",
      true,
      "client-1"
    )
  })

  it("refuses to pause a connection of the parent or of another client", async () => {
    // El registro no encuentra la fila fuera del alcance del cliente.
    mocks.setPageForwardingPaused.mockResolvedValue(null)

    await expect(
      setConnectionForwardingPaused("connection-of-parent", true)
    ).resolves.toEqual({ error: es.actions.pageNotFound })
  })

  it("disconnects only within its own connections", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      page: { channel: "instagram", metaPageId: "ig-1" },
      pageAccessToken: "ig-token",
    })
    mocks.disconnectPage.mockResolvedValue({
      id: "connection-1",
      metaPageId: "ig-1",
    })

    const formData = new FormData()
    formData.set("connectionId", "connection-1")
    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      message: es.actions.disconnected,
    })

    expect(mocks.getActivePageWithTokenByConnectionId).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1",
      "client-1"
    )
    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      "tenant-1",
      "connection-1",
      "client-1"
    )
  })

  it("refuses to disconnect a connection of the parent or of another client", async () => {
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue(null)
    mocks.disconnectPage.mockResolvedValue(null)

    const formData = new FormData()
    formData.set("connectionId", "connection-of-other-client")
    await expect(disconnectPageAction({}, formData)).resolves.toEqual({
      error: es.actions.pageNotFound,
    })
    expect(mocks.unsubscribeChannelWebhook).not.toHaveBeenCalled()
  })

  it("never touches the webhook: the URL belongs to the parent", async () => {
    const formData = new FormData()
    formData.set("connectionId", "connection-1")
    formData.set("webhookUrl", "https://hooks.vetta.app/resender")

    await expect(saveWebhookUrlAction({}, formData)).resolves.toEqual({
      error: es.actions.pageNotFound,
    })
    expect(mocks.updatePageWebhookUrl).not.toHaveBeenCalled()
  })
})
