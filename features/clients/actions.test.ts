import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  requireOwner: vi.fn(),
  revalidatePath: vi.fn(),
  log: vi.fn(),
  assignConnectionToClient: vi.fn(),
  createAgencyClient: vi.fn(),
  createAgencyClientInvitation: vi.fn(),
  deleteAgencyClient: vi.fn(),
  revokeAgencyClientAccess: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

// Sin cookie de idioma cae en español, que es el idioma de las aserciones.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
  headers: async () => new Headers({ host: "localhost:3000" }),
}))

vi.mock("@/lib/auth/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/actor")>()),
  requireOwner: mocks.requireOwner,
}))

vi.mock("@/lib/clients/client-repository", () => ({
  assignConnectionToClient: mocks.assignConnectionToClient,
  cancelAgencyClientInvitation: vi.fn(),
  createAgencyClient: mocks.createAgencyClient,
  createAgencyClientInvitation: mocks.createAgencyClientInvitation,
  deleteAgencyClient: mocks.deleteAgencyClient,
  renameAgencyClient: vi.fn(),
  revokeAgencyClientAccess: mocks.revokeAgencyClientAccess,
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

vi.mock("@/lib/posthog", () => ({ posthog: null }))

import { es } from "@/content/i18n/app/es"
import { hashInviteToken } from "@/lib/clients/invite-token"

import {
  assignConnectionAction,
  createAgencyClientAction,
  createAgencyClientInviteAction,
  deleteAgencyClientAction,
  revokeAgencyClientAccessAction,
} from "./actions"

function form(entries: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) formData.set(key, value)
  return formData
}

const owner = {
  ok: true,
  actor: { kind: "owner", userId: "tenant-1", tenantId: "tenant-1" },
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.cookieGet.mockReturnValue(undefined)
  vi.unstubAllEnvs()
})

// Todo lo de clientes es del dueño (ADR 0020). La persona de un cliente de
// agencia no crea, no invita, no revoca, no borra y no asigna, ni por POST
// directo, y la acción no llega al repositorio.
describe("acciones de clientes para la persona de un cliente de agencia", () => {
  beforeEach(() => {
    mocks.requireOwner.mockResolvedValue({ ok: false, denial: "not_owner" })
  })

  it("rechaza todas sin tocar la base", async () => {
    const denied = { error: es.actions.ownerOnly }

    await expect(
      createAgencyClientAction({}, form({ name: "Otro" }))
    ).resolves.toEqual(denied)
    await expect(
      createAgencyClientInviteAction({}, form({ clientId: "c1" }))
    ).resolves.toEqual(denied)
    await expect(
      revokeAgencyClientAccessAction({}, form({ clientId: "c1" }))
    ).resolves.toEqual(denied)
    await expect(
      deleteAgencyClientAction({}, form({ clientId: "c1" }))
    ).resolves.toEqual(denied)
    await expect(assignConnectionAction("conn-1", "c1")).resolves.toEqual(
      denied
    )

    expect(mocks.createAgencyClient).not.toHaveBeenCalled()
    expect(mocks.createAgencyClientInvitation).not.toHaveBeenCalled()
    expect(mocks.revokeAgencyClientAccess).not.toHaveBeenCalled()
    expect(mocks.deleteAgencyClient).not.toHaveBeenCalled()
    expect(mocks.assignConnectionToClient).not.toHaveBeenCalled()
  })
})

describe("createAgencyClientInviteAction", () => {
  beforeEach(() => {
    mocks.requireOwner.mockResolvedValue(owner)
    mocks.createAgencyClientInvitation.mockResolvedValue({
      ok: true,
      expiresAt: new Date(),
    })
  })

  it("devuelve el enlace con el token y guarda solo su hash", async () => {
    vi.stubEnv("APP_URL", "https://resender.dev/")

    const result = await createAgencyClientInviteAction(
      {},
      form({ clientId: "c1", email: "Pedro@Example.com" })
    )

    const url = new URL(result.inviteUrl!)
    expect(url.origin).toBe("https://resender.dev")
    expect(url.pathname).toBe("/invite")
    const token = url.searchParams.get("token")!
    expect(mocks.createAgencyClientInvitation).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      clientId: "c1",
      tokenHash: hashInviteToken(token),
      email: "pedro@example.com",
    })
    // Ni el token ni el enlace en el log.
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(token)
  })

  it("rechaza un correo inválido antes de generar nada", async () => {
    await expect(
      createAgencyClientInviteAction({}, form({ clientId: "c1", email: "x" }))
    ).resolves.toEqual({ error: es.actions.inviteEmailInvalid })
    expect(mocks.createAgencyClientInvitation).not.toHaveBeenCalled()
  })

  it("avisa si el cliente ya tiene una persona", async () => {
    mocks.createAgencyClientInvitation.mockResolvedValue({
      ok: false,
      reason: "client_has_member",
    })
    await expect(
      createAgencyClientInviteAction({}, form({ clientId: "c1" }))
    ).resolves.toEqual({ error: es.actions.clientHasMember })
  })
})

describe("createAgencyClientAction", () => {
  it("valida el nombre antes de crear", async () => {
    mocks.requireOwner.mockResolvedValue(owner)

    await expect(
      createAgencyClientAction({}, form({ name: "   " }))
    ).resolves.toEqual({ error: es.actions.clientNameRequired })
    expect(mocks.createAgencyClient).not.toHaveBeenCalled()
  })
})
