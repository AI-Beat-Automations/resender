import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  // Si devuelve un actor, reemplaza al dueño que se deriva de `getSession`.
  actorOverride: vi.fn(),
  cookieGet: vi.fn(),
  disconnectPage: vi.fn(),
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

// El actor se deriva de la sesión mockeada: una sesión es un dueño, salvo que
// el test pida otro actor. Es una función y no un `vi.fn` para que el
// `mockReset` de cada test no le borre la implementación.
vi.mock("@/lib/auth/actor", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/actor")>()
  const requireActor = async () => {
    const override = mocks.actorOverride()
    if (override) return { ok: true, actor: override }
    const session = await mocks.getSession()
    if (!session) return { ok: false, denial: "not_signed_in" }
    return {
      ok: true,
      actor: {
        kind: "owner",
        userId: session.user.id,
        tenantId: session.user.id,
      },
    }
  }
  return {
    ...original,
    requireActor,
    requireOwner: async () => {
      const gate = await requireActor()
      if (!gate.ok) return gate
      if (gate.actor.kind !== "owner") {
        return { ok: false, denial: "not_owner" }
      }
      return gate
    },
  }
})

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
    updatePageWebhookUrl: mocks.updatePageWebhookUrl,
  }
})

vi.mock("@/lib/posthog", () => ({
  posthog: null,
}))

import { InvalidWebhookUrlError } from "@/lib/pages/page-registry"
import { es } from "@/content/i18n/app/es"

import { disconnectPageAction, saveWebhookUrlAction } from "./actions"

describe("disconnectPageAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
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

    expect(mocks.getActivePageWithTokenByConnectionId).toHaveBeenCalledWith(
      { tenantId: "tenant-1", owner: true, clientId: null },
      "connection-1"
    )
    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      { tenantId: "tenant-1", owner: true, clientId: null },
      "connection-1"
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
      { tenantId: "tenant-1", owner: true, clientId: null },
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
      { tenantId: "tenant-1", owner: true, clientId: null },
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
    mocks.getSession.mockResolvedValue(null)
    await expect(disconnectPageAction({}, new FormData())).resolves.toEqual({
      error: "No has iniciado sesión.",
    })

    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
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

// Modo agencia (ADR 0020): la persona de un cliente desconecta, pero solo
// dentro de su cliente; el webhook no lo toca.
const pedro = {
  kind: "client",
  userId: "user-pedro",
  tenantId: "tenant-1",
  clientId: "client-pedro",
  clientName: "Panadería Pedro",
}

describe("disconnectPageAction para un cliente de agencia", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.actorOverride.mockReturnValue(pedro)
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue(null)
    mocks.disconnectPage.mockResolvedValue({
      id: "connection-1",
      metaPageId: "meta-page-1",
    })
  })

  it("desconecta dentro del alcance de su cliente", async () => {
    const formData = new FormData()
    formData.set("connectionId", "connection-1")

    await disconnectPageAction({}, formData)

    const clientScope = {
      tenantId: "tenant-1",
      owner: false,
      clientId: "client-pedro",
    }
    expect(mocks.getActivePageWithTokenByConnectionId).toHaveBeenCalledWith(
      clientScope,
      "connection-1"
    )
    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      clientScope,
      "connection-1"
    )
  })
})

describe("saveWebhookUrlAction para un cliente de agencia", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.actorOverride.mockReturnValue(pedro)
  })

  it("no deja tocar el webhook y no llega a la base", async () => {
    const formData = new FormData()
    formData.set("connectionId", "connection-1")
    formData.set("webhookUrl", "https://evil.example/hook")

    await expect(saveWebhookUrlAction({}, formData)).resolves.toEqual({
      error: es.actions.ownerOnly,
    })
    expect(mocks.updatePageWebhookUrl).not.toHaveBeenCalled()
  })
})

describe("saveWebhookUrlAction", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
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
    await expect(saveWebhookUrlAction({}, new FormData())).resolves.toEqual({
      error: "Página inválida.",
    })

    mocks.updatePageWebhookUrl.mockResolvedValue(null)
    await expect(
      saveWebhookUrlAction({}, webhookForm("https://hooks.vetta.app/resender"))
    ).resolves.toEqual({ error: "No encontramos esa página." })
  })
})
