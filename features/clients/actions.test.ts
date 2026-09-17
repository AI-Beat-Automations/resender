import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  cookieGet: vi.fn(),
  revalidatePath: vi.fn(),
  resolveClientPlan: vi.fn(),
  createClientAccount: vi.fn(),
  getClientAccount: vi.fn(),
  isEmailTaken: vi.fn(),
  updateClientMaxConnections: vi.fn(),
  deleteClientWithConnections: vi.fn(),
  deleteClientRows: vi.fn(),
  issueInvitation: vi.fn(),
  cancelPendingInvitations: vi.fn(),
  getLatestInvitation: vi.fn(),
  sendClientInvitationEmail: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

// El idioma sale de la cookie `lang`; sin store cae en español, que es el
// idioma de las aserciones de abajo (patrón de `features/connections`).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}))

vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }))
vi.mock("@/lib/clients/client-plan", () => ({
  resolveClientPlan: mocks.resolveClientPlan,
}))
vi.mock("@/lib/clients/client-accounts", () => ({
  createClientAccount: mocks.createClientAccount,
  getClientAccount: mocks.getClientAccount,
  isEmailTaken: mocks.isEmailTaken,
  updateClientMaxConnections: mocks.updateClientMaxConnections,
}))
vi.mock("@/lib/clients/client-deletion", () => ({
  deleteClientWithConnections: mocks.deleteClientWithConnections,
  deleteClientRows: mocks.deleteClientRows,
}))
vi.mock("@/lib/clients/invitations", () => ({
  issueInvitation: mocks.issueInvitation,
  cancelPendingInvitations: mocks.cancelPendingInvitations,
  getLatestInvitation: mocks.getLatestInvitation,
}))
vi.mock("@/lib/email/client-invitation-email", () => ({
  sendClientInvitationEmail: mocks.sendClientInvitationEmail,
}))
vi.mock("@/lib/posthog", () => ({ posthog: null }))

import { es } from "@/content/i18n/app/es"

import {
  cancelInvitationAction,
  createClientAction,
  deleteClientAction,
  resendInvitationAction,
  updateClientMaxAction,
} from "./actions"

const PRO = { canManage: true, maxPages: 5 }
const STARTER = { canManage: false, maxPages: 2 }

const client = {
  id: "client-1",
  tenantId: "tenant-1",
  userId: null,
  name: "Panadería Sol",
  maxConnections: 2,
  status: "pending" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function createForm(input: {
  name?: string
  email?: string
  maxConnections?: string
}) {
  const formData = new FormData()
  formData.set("name", input.name ?? "Panadería Sol")
  formData.set("email", input.email ?? "Cliente@Example.com ")
  formData.set("maxConnections", input.maxConnections ?? "2")
  return formData
}

function clientForm(extra: Record<string, string> = {}) {
  const formData = new FormData()
  formData.set("clientAccountId", "client-1")
  for (const [key, value] of Object.entries(extra)) formData.set(key, value)
  return formData
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.cookieGet.mockReturnValue(undefined)
  mocks.getSession.mockResolvedValue({
    user: { id: "tenant-1", email: "ada@example.com", name: "Ada" },
  })
  mocks.resolveClientPlan.mockResolvedValue(PRO)
  mocks.isEmailTaken.mockResolvedValue(false)
  mocks.createClientAccount.mockResolvedValue(client)
  mocks.getClientAccount.mockResolvedValue(client)
  mocks.issueInvitation.mockResolvedValue({
    id: "inv-1",
    token: "tok-123",
    email: "cliente@example.com",
    expiresAt: new Date(),
  })
  mocks.sendClientInvitationEmail.mockResolvedValue({
    ok: true,
    status: 200,
    error: null,
    reason: null,
  })
  process.env.BETTER_AUTH_URL = "https://resender.dev"
})

describe("createClientAction", () => {
  it("crea el cliente, emite la invitación y manda el correo con el nombre del padre", async () => {
    await expect(createClientAction({}, createForm({}))).resolves.toEqual({
      message:
        "Cliente creado. Le enviamos la invitación a cliente@example.com.",
    })

    expect(mocks.createClientAccount).toHaveBeenCalledWith("tenant-1", {
      name: "Panadería Sol",
      maxConnections: 2,
    })
    expect(mocks.issueInvitation).toHaveBeenCalledWith({
      clientAccountId: "client-1",
      email: "cliente@example.com",
    })
    expect(mocks.sendClientInvitationEmail).toHaveBeenCalledWith({
      to: "cliente@example.com",
      locale: "es",
      clientName: "Panadería Sol",
      ownerName: "Ada",
      inviteUrl: "https://resender.dev/invitacion/tok-123",
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clientes")
  })

  it("rechaza un plan sin permiso sin crear nada", async () => {
    mocks.resolveClientPlan.mockResolvedValue(STARTER)

    await expect(createClientAction({}, createForm({}))).resolves.toEqual({
      error: es.actions.clientsPlanNotAllowed,
    })
    expect(mocks.createClientAccount).not.toHaveBeenCalled()
    expect(mocks.sendClientInvitationEmail).not.toHaveBeenCalled()
  })

  it("rechaza un correo ya registrado con mensaje claro", async () => {
    mocks.isEmailTaken.mockResolvedValue(true)

    await expect(createClientAction({}, createForm({}))).resolves.toEqual({
      error: es.actions.clientEmailAlreadyRegistered,
    })
    expect(mocks.isEmailTaken).toHaveBeenCalledWith("cliente@example.com")
    expect(mocks.createClientAccount).not.toHaveBeenCalled()
  })

  it.each(["0", "6", "abc", ""])(
    "rechaza el tope %s fuera de 1..maxPages del plan",
    async (maxConnections) => {
      await expect(
        createClientAction({}, createForm({ maxConnections }))
      ).resolves.toEqual({
        error: "El tope de conexiones tiene que estar entre 1 y 5.",
      })
      expect(mocks.createClientAccount).not.toHaveBeenCalled()
    }
  )

  it("valida nombre y correo antes de tocar la base", async () => {
    await expect(
      createClientAction({}, createForm({ name: "  " }))
    ).resolves.toEqual({ error: es.actions.clientNameRequired })
    await expect(
      createClientAction({}, createForm({ email: "no-es-correo" }))
    ).resolves.toEqual({ error: es.actions.invalidEmail })
    expect(mocks.isEmailTaken).not.toHaveBeenCalled()
  })

  it("si el correo no sale, el cliente queda creado y lo dice", async () => {
    mocks.sendClientInvitationEmail.mockResolvedValue({
      ok: false,
      status: 500,
      error: "boom",
      reason: "http_error",
    })

    await expect(createClientAction({}, createForm({}))).resolves.toEqual({
      error: es.actions.clientCreatedEmailFailed,
    })
    expect(mocks.createClientAccount).toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clientes")
  })

  it("si emitir la invitación falla, borra el cliente recién creado y relanza", async () => {
    mocks.issueInvitation.mockRejectedValue(new Error("db down"))

    await expect(createClientAction({}, createForm({}))).rejects.toThrow(
      "db down"
    )
    expect(mocks.deleteClientRows).toHaveBeenCalledWith(client)
    expect(mocks.sendClientInvitationEmail).not.toHaveBeenCalled()
  })

  it("usa el correo del padre como nombre si no tiene nombre", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "tenant-1", email: "ada@example.com", name: "" },
    })
    await createClientAction({}, createForm({}))
    expect(mocks.sendClientInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ownerName: "ada@example.com" })
    )
  })

  it("responde en español sin sesión", async () => {
    mocks.getSession.mockResolvedValue(null)
    await expect(createClientAction({}, createForm({}))).resolves.toEqual({
      error: "No has iniciado sesión.",
    })
  })
})

describe("resendInvitationAction", () => {
  beforeEach(() => {
    mocks.getLatestInvitation.mockResolvedValue({
      id: "inv-0",
      email: "cliente@example.com",
      expiresAt: new Date(),
      acceptedAt: null,
      cancelledAt: null,
    })
  })

  // `issueInvitation` cancela la anterior y emite un token nuevo: reenviar es
  // «el enlace viejo deja de servir».
  it("emite una invitación nueva al mismo correo y manda el correo", async () => {
    await expect(resendInvitationAction({}, clientForm())).resolves.toEqual({
      message: "Invitación reenviada a cliente@example.com.",
    })
    expect(mocks.issueInvitation).toHaveBeenCalledWith({
      clientAccountId: "client-1",
      email: "cliente@example.com",
    })
    expect(mocks.sendClientInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "cliente@example.com",
        inviteUrl: "https://resender.dev/invitacion/tok-123",
      })
    )
  })

  it("no reenvía a un cliente activo ni a uno ajeno", async () => {
    mocks.getClientAccount.mockResolvedValue({ ...client, status: "active" })
    await expect(resendInvitationAction({}, clientForm())).resolves.toEqual({
      error: es.actions.clientInvitationNotFound,
    })

    mocks.getClientAccount.mockResolvedValue(null)
    await expect(resendInvitationAction({}, clientForm())).resolves.toEqual({
      error: es.actions.clientNotFound,
    })
    expect(mocks.issueInvitation).not.toHaveBeenCalled()
  })

  it("rechaza un plan sin permiso", async () => {
    mocks.resolveClientPlan.mockResolvedValue(STARTER)
    await expect(resendInvitationAction({}, clientForm())).resolves.toEqual({
      error: es.actions.clientsPlanNotAllowed,
    })
  })
})

describe("cancelInvitationAction", () => {
  it("marca la pendiente como cancelada", async () => {
    mocks.cancelPendingInvitations.mockResolvedValue(1)
    await expect(cancelInvitationAction({}, clientForm())).resolves.toEqual({
      message: es.actions.clientInvitationCancelled,
    })
    expect(mocks.cancelPendingInvitations).toHaveBeenCalledWith("client-1")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clientes")
  })

  it("dice que no hay invitación pendiente cuando no cancela nada", async () => {
    mocks.cancelPendingInvitations.mockResolvedValue(0)
    await expect(cancelInvitationAction({}, clientForm())).resolves.toEqual({
      error: es.actions.clientInvitationNotFound,
    })
  })
})

describe("updateClientMaxAction", () => {
  it("aplica la misma validación de rango que al crear", async () => {
    await expect(
      updateClientMaxAction({}, clientForm({ maxConnections: "9" }))
    ).resolves.toEqual({
      error: "El tope de conexiones tiene que estar entre 1 y 5.",
    })
    expect(mocks.updateClientMaxConnections).not.toHaveBeenCalled()
  })

  it("acepta un tope menor a lo conectado: no desconecta nada", async () => {
    mocks.updateClientMaxConnections.mockResolvedValue({
      ...client,
      maxConnections: 1,
    })
    await expect(
      updateClientMaxAction({}, clientForm({ maxConnections: "1" }))
    ).resolves.toEqual({ message: es.actions.clientMaxUpdated })
    expect(mocks.updateClientMaxConnections).toHaveBeenCalledWith(
      "tenant-1",
      "client-1",
      1
    )
    expect(mocks.deleteClientWithConnections).not.toHaveBeenCalled()
  })

  it("rechaza un plan sin permiso", async () => {
    mocks.resolveClientPlan.mockResolvedValue(STARTER)
    await expect(
      updateClientMaxAction({}, clientForm({ maxConnections: "1" }))
    ).resolves.toEqual({ error: es.actions.clientsPlanNotAllowed })
  })
})

describe("deleteClientAction", () => {
  // El procedimiento (baja en Meta de cada conexión + borrado) vive en
  // `lib/clients/client-deletion.ts` y se prueba ahí; acá se comprueba que la
  // acción lo dispara con el tenant de la sesión y refresca las dos listas.
  it("dispara el procedimiento de borrado para el tenant de la sesión", async () => {
    mocks.deleteClientWithConnections.mockResolvedValue(client)
    await expect(deleteClientAction({}, clientForm())).resolves.toEqual({
      message: es.actions.clientDeleted,
    })
    expect(mocks.deleteClientWithConnections).toHaveBeenCalledWith(
      "tenant-1",
      "client-1"
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clientes")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
  })

  it("no encuentra un cliente ajeno", async () => {
    mocks.deleteClientWithConnections.mockResolvedValue(null)
    await expect(deleteClientAction({}, clientForm())).resolves.toEqual({
      error: es.actions.clientNotFound,
    })
  })
})
