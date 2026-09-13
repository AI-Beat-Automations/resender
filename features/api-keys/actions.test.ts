import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  requireOwner: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

// Sin cookie de idioma cae en español, que es el idioma de las aserciones.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}))

vi.mock("@/lib/auth/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/actor")>()),
  requireOwner: mocks.requireOwner,
}))

vi.mock("@/lib/auth/api-keys", () => {
  class InvalidApiKeyLabelError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return {
    createApiKey: mocks.createApiKey,
    revokeApiKey: mocks.revokeApiKey,
    InvalidApiKeyLabelError,
  }
})

vi.mock("@/lib/posthog", () => ({ posthog: null }))

import { es } from "@/content/i18n/app/es"

import { createApiKeyAction, revokeApiKeyAction } from "./actions"

// Modo agencia (ADR 0020): las API keys son de la integración de la agencia.
describe("API keys para la persona de un cliente de agencia", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.requireOwner.mockResolvedValue({ ok: false, denial: "not_owner" })
  })

  it("no crea una key", async () => {
    const formData = new FormData()
    formData.set("label", "N8N")

    await expect(createApiKeyAction({}, formData)).resolves.toEqual({
      error: es.actions.ownerOnly,
    })
    expect(mocks.createApiKey).not.toHaveBeenCalled()
  })

  it("no revoca una key", async () => {
    const formData = new FormData()
    formData.set("apiKeyId", "key-1")

    await expect(revokeApiKeyAction({}, formData)).resolves.toEqual({
      error: es.actions.ownerOnly,
    })
    expect(mocks.revokeApiKey).not.toHaveBeenCalled()
  })
})

describe("API keys para el dueño", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.requireOwner.mockResolvedValue({
      ok: true,
      actor: { kind: "owner", userId: "tenant-1", tenantId: "tenant-1" },
    })
  })

  it("crea la key en el tenant del dueño", async () => {
    mocks.createApiKey.mockResolvedValue({
      apiKey: "pk_live_secreto",
      record: { id: "key-1", label: "N8N" },
    })
    const formData = new FormData()
    formData.set("label", "N8N")

    await expect(createApiKeyAction({}, formData)).resolves.toMatchObject({
      apiKey: "pk_live_secreto",
    })
    expect(mocks.createApiKey).toHaveBeenCalledWith("tenant-1", "N8N")
  })
})
