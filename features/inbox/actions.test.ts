import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActorByUserId: vi.fn(),
  cookieGet: vi.fn(),
  setConversationForwardingPaused: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

// Sin cookie `lang` la acción responde en español, que es el idioma de las
// aserciones de abajo (mismo molde que `features/connections/actions.test.ts`).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}))

vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.getSession,
}))

// El actor se lee vivo de la base (issue #154): el padre actúa sobre todo el
// tenant y el cliente solo sobre las conversaciones de sus conexiones.
vi.mock("@/lib/clients/actor", () => ({
  resolveActorByUserId: mocks.resolveActorByUserId,
}))

vi.mock("@/lib/messages/message-log", () => ({
  setConversationForwardingPaused: mocks.setConversationForwardingPaused,
}))

vi.mock("@/lib/posthog", () => ({
  posthog: null,
}))

import { es } from "@/content/i18n/app/es"

import { setConversationForwardingPaused } from "./actions"

const PARENT = { tenantId: "tenant-1", userId: "tenant-1", clientAccountId: null }
const CLIENT = {
  tenantId: "tenant-1",
  userId: "user-2",
  clientAccountId: "client-1",
}

const PAUSED = {
  id: "conv-1",
  tenantId: "tenant-1",
  connectedPageId: "connection-1",
  contactId: "psid-1",
  contactName: null,
  lastMessageAt: new Date("2026-07-15T00:00:00Z"),
  lastInboundAt: null,
  pausedAt: new Date("2026-07-15T10:00:00Z"),
}

describe("setConversationForwardingPaused as the parent", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: PARENT })
  })

  it("pauses over the whole tenant and revalidates Inbox", async () => {
    mocks.setConversationForwardingPaused.mockResolvedValue(PAUSED)

    await expect(
      setConversationForwardingPaused("conv-1", true)
    ).resolves.toEqual({ pausedAt: "2026-07-15T10:00:00.000Z" })

    // El padre no tiene alcance de cliente: `null` ve todo el tenant, incluidas
    // las conversaciones de las conexiones de sus clientes.
    expect(mocks.setConversationForwardingPaused).toHaveBeenCalledWith(
      "tenant-1",
      "conv-1",
      true,
      null
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox")
  })

  it("answers in Spanish when the session or the id are missing", async () => {
    mocks.getSession.mockResolvedValue(null)
    await expect(
      setConversationForwardingPaused("conv-1", true)
    ).resolves.toEqual({ error: es.actions.notSignedIn })

    mocks.getSession.mockResolvedValue({ user: { id: "tenant-1" } })
    await expect(setConversationForwardingPaused("", true)).resolves.toEqual({
      error: es.actions.conversationNotFound,
    })
    expect(mocks.setConversationForwardingPaused).not.toHaveBeenCalled()
  })

  it("refuses a user without actor, like a client still pending", async () => {
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "client_pending" })
    await expect(
      setConversationForwardingPaused("conv-1", true)
    ).resolves.toEqual({ error: es.actions.notSignedIn })
    expect(mocks.setConversationForwardingPaused).not.toHaveBeenCalled()
  })
})

// Con actor cliente (issue #154, ticket 4): la pausa va con el alcance de su
// `client_account_id`, así que una conversación de una conexión del padre o
// de otro cliente no se encuentra —el registro devuelve `null`— y la acción
// responde lo mismo que para un id inexistente.
describe("setConversationForwardingPaused as a client", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getSession.mockResolvedValue({ user: { id: "user-2" } })
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: CLIENT })
  })

  it("pauses only within the conversations of its own connections", async () => {
    mocks.setConversationForwardingPaused.mockResolvedValue({
      ...PAUSED,
      pausedAt: null,
    })

    await expect(
      setConversationForwardingPaused("conv-1", false)
    ).resolves.toEqual({ pausedAt: null })

    // El tenant es el del padre; el alcance, el del cliente.
    expect(mocks.setConversationForwardingPaused).toHaveBeenCalledWith(
      "tenant-1",
      "conv-1",
      false,
      "client-1"
    )
  })

  it("refuses a conversation of the parent or of another client", async () => {
    mocks.setConversationForwardingPaused.mockResolvedValue(null)

    await expect(
      setConversationForwardingPaused("conv-of-parent", true)
    ).resolves.toEqual({ error: es.actions.conversationNotFound })

    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
