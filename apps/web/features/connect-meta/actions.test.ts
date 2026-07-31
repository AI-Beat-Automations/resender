import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  connectMetaPages: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/backend/backend", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/backend/backend")>()
  return { ...original, connectMetaPages: mocks.connectMetaPages }
})

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import { connectSelectedPagesAction } from "./actions"

const USER_ID = "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"

describe("connectSelectedPagesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: USER_ID } })
    mocks.connectMetaPages.mockResolvedValue([pageDto()])
  })

  it("derives the actor from session, sends only validated Page ids, and redirects with safe DTO data", async () => {
    await connectSelectedPagesAction({}, selection("provider_page_1"))

    expect(mocks.connectMetaPages).toHaveBeenCalledWith(
      { userId: USER_ID },
      { providerPageIds: ["provider_page_1"] }
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/connections?meta=connected&pages=${encodeURIComponent(
        JSON.stringify([{ id: "provider_page_1", name: "Support" }])
      )}`
    )
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain("token")
  })

  it.each([
    ["empty", selection()],
    ["duplicates", selection("page_1", "page_1")],
    [
      "more than 100",
      selection(...Array.from({ length: 101 }, (_, i) => `page_${i}`)),
    ],
    ["non-string", selectionFile()],
  ])("rejects %s input before RPC", async (_label, formData) => {
    await expect(connectSelectedPagesAction({}, formData)).resolves.toEqual({
      error: "Elige al menos una página válida.",
    })
    expect(mocks.connectMetaPages).not.toHaveBeenCalled()
  })

  it.each([
    [
      rpcError("account_waitlisted", "access", 403, "/waitlist"),
      "Tu cuenta está en la lista de espera.",
    ],
    [
      rpcError("subscription_required", "access", 403, "/billing"),
      "Tu suscripción no está activa.",
    ],
    [
      rpcError("page_limit_exceeded", "entitlement", 403),
      "No tienes cupo disponible para esa selección. Desconecta una página o revisa tu plan.",
    ],
    [
      rpcError("not_found", "not_found", 404),
      "Esa selección ya no está disponible. Recarga la pantalla e inténtalo de nuevo.",
    ],
    [
      rpcError("provider_rejected", "provider", 422),
      "Las páginas seleccionadas ya no están disponibles. Vuelve a conectar Facebook e inténtalo de nuevo.",
    ],
    [
      new BackendUnavailableError(),
      "No pudimos conectar las páginas en este momento. Inténtalo de nuevo.",
    ],
    [
      new BackendProtocolError(),
      "No pudimos conectar las páginas en este momento. Inténtalo de nuevo.",
    ],
  ])("maps backend failures to fixed neutral copy", async (error, message) => {
    mocks.connectMetaPages.mockRejectedValue(error)

    const result = await connectSelectedPagesAction(
      {},
      selection("foreign-or-stale-page")
    )

    expect(result).toEqual({ error: message })
    expect(JSON.stringify(result)).not.toContain("foreign-or-stale-page")
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("does not accept an actor from form input", async () => {
    const form = selection("provider_page_1")
    form.set("userId", "attacker-tenant")

    await connectSelectedPagesAction({}, form)

    expect(mocks.connectMetaPages).toHaveBeenCalledWith(
      { userId: USER_ID },
      { providerPageIds: ["provider_page_1"] }
    )
  })
})

function selection(...pageIds: string[]) {
  const data = new FormData()
  for (const pageId of pageIds) data.append("pageIds", pageId)
  return data
}

function selectionFile() {
  const data = new FormData()
  data.append("pageIds", new File(["page"], "page.txt"))
  return data
}

function rpcError(
  code:
    | "account_waitlisted"
    | "subscription_required"
    | "page_limit_exceeded"
    | "not_found"
    | "provider_rejected",
  kind: "access" | "entitlement" | "not_found" | "provider",
  status: number,
  destination?: "/waitlist" | "/billing"
) {
  return new BackendRpcError({
    code,
    kind,
    status,
    retryable: false,
    ...(destination ? { destination } : {}),
  })
}

function pageDto() {
  return {
    id: "f251bd5a-2772-489a-a725-43e2ea9d44ee",
    provider: "meta",
    providerPageId: "provider_page_1",
    name: "Support",
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenErrorAt: null,
    disconnectedAt: null,
    webhook: { url: null, signingEnabled: true },
    connectedAt: "2026-07-29T18:00:00.000Z",
    updatedAt: "2026-07-29T18:00:00.000Z",
  }
}
