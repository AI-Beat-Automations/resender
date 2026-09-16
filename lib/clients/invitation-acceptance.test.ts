import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock, setUserPassword } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  setUserPassword: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ getSql: () => sqlMock }))
vi.mock("@/lib/auth/set-password", () => ({ setUserPassword }))

import { hashInvitationToken } from "./invitation-token"
import {
  acceptInvitation,
  classifyInvitation,
  peekInvitation,
} from "./invitations"

// Mismo patrón `sqlMock` que `password-reset.test.ts`: se comprueba lo que se
// consulta y lo que se escribe, nunca la forma interna.
function queryText(call: unknown[]): string {
  return (call[0] as string[]).join("")
}

const now = new Date("2026-09-16T10:00:00Z")

const liveRow = {
  id: "inv-1",
  client_account_id: "client-1",
  email: "cliente@example.com",
  expires_at: new Date("2026-09-20T10:00:00Z"),
  accepted_at: null,
  cancelled_at: null,
  tenant_id: "parent-1",
  client_name: "Panadería Sol",
  owner_name: "Ada",
  owner_email: "ada@example.com",
}

describe("classifyInvitation", () => {
  it("distingue vencida, cancelada, consumida y desconocida", () => {
    expect(classifyInvitation(liveRow, now)).toBe("live")
    expect(classifyInvitation(undefined, now)).toBe("unknown")
    expect(classifyInvitation({ ...liveRow, accepted_at: now }, now)).toBe(
      "consumed"
    )
    expect(classifyInvitation({ ...liveRow, cancelled_at: now }, now)).toBe(
      "cancelled"
    )
    expect(
      classifyInvitation(
        { ...liveRow, expires_at: new Date("2026-09-10T10:00:00Z") },
        now
      )
    ).toBe("expired")
  })
})

describe("peekInvitation", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    sqlMock.mockResolvedValue([])
  })

  it("busca por el hash del token, sin escribir nada", async () => {
    sqlMock.mockResolvedValue([liveRow])
    const peek = await peekInvitation("tok-abc", now)

    expect(peek).toEqual({
      state: "live",
      clientName: "Panadería Sol",
      email: "cliente@example.com",
      ownerName: "Ada",
    })
    const call = sqlMock.mock.calls[0]!
    const [, ...params] = call
    expect(params).toContain(hashInvitationToken("tok-abc"))
    expect(params).not.toContain("tok-abc")
    expect(queryText(call).toLowerCase()).not.toContain("update")
  })

  it("el padre sin nombre se presenta por su correo", async () => {
    sqlMock.mockResolvedValue([{ ...liveRow, owner_name: "" }])
    expect(await peekInvitation("tok-abc", now)).toMatchObject({
      ownerName: "ada@example.com",
    })
  })

  it("dice por qué no sirve y no consulta con token vacío", async () => {
    expect(await peekInvitation("", now)).toEqual({ state: "unknown" })
    expect(sqlMock).not.toHaveBeenCalled()

    sqlMock.mockResolvedValue([{ ...liveRow, cancelled_at: now }])
    expect(await peekInvitation("tok-abc", now)).toEqual({ state: "cancelled" })
  })
})

describe("acceptInvitation", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    setUserPassword.mockReset()
    setUserPassword.mockResolvedValue(undefined)
  })

  const input = {
    token: "tok-abc",
    name: "Sol Pérez",
    password: "correct horse",
    now,
  }

  function acceptHappyPath() {
    sqlMock
      // 1. la invitación con su cliente y su padre
      .mockResolvedValueOnce([liveRow])
      // 2. ¿el correo ya tiene cuenta?
      .mockResolvedValueOnce([{ taken: false }])
      // 3. consumir el token
      .mockResolvedValueOnce([{ id: "inv-1" }])
      // 4. alta del user
      .mockResolvedValueOnce([{ id: "user-9" }])
      // 5. enlazar el cliente
      .mockResolvedValueOnce([{ id: "client-1" }])
  }

  it("crea el user verificado, fija la contraseña con el primitivo y consume la invitación", async () => {
    acceptHappyPath()

    const result = await acceptInvitation(input)

    expect(result).toEqual({
      ok: true,
      userId: "user-9",
      email: "cliente@example.com",
      tenantId: "parent-1",
      clientAccountId: "client-1",
    })

    const consume = sqlMock.mock.calls[2]!
    expect(queryText(consume)).toContain("update client_invitations")
    expect(queryText(consume)).toContain("set accepted_at = now()")
    expect(queryText(consume)).toContain("accepted_at is null")
    expect(queryText(consume)).toContain("cancelled_at is null")
    expect(queryText(consume)).toContain("expires_at > now()")
    expect(consume).toContain("inv-1")

    const insert = sqlMock.mock.calls[3]!
    const [, ...insertParams] = insert
    expect(queryText(insert)).toContain("insert into users")
    expect(queryText(insert)).toContain("email_verified")
    expect(insertParams).toEqual(["cliente@example.com", "Sol Pérez", true])

    expect(setUserPassword).toHaveBeenCalledWith("user-9", "correct horse")

    const link = sqlMock.mock.calls[4]!
    expect(queryText(link)).toContain("update client_accounts")
    expect(queryText(link)).toContain("status = 'active'")
    expect(link).toContain("user-9")
    expect(link).toContain("client-1")
  })

  it("una invitación vencida no acepta: ni user ni contraseña", async () => {
    sqlMock.mockResolvedValueOnce([
      { ...liveRow, expires_at: new Date("2026-09-10T10:00:00Z") },
    ])

    expect(await acceptInvitation(input)).toEqual({
      ok: false,
      reason: "expired",
    })
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(setUserPassword).not.toHaveBeenCalled()
  })

  it("una invitación cancelada no acepta", async () => {
    sqlMock.mockResolvedValueOnce([{ ...liveRow, cancelled_at: now }])

    expect(await acceptInvitation(input)).toEqual({
      ok: false,
      reason: "cancelled",
    })
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(setUserPassword).not.toHaveBeenCalled()
  })

  it("una invitación ya usada o desconocida no acepta", async () => {
    sqlMock.mockResolvedValueOnce([{ ...liveRow, accepted_at: now }])
    expect(await acceptInvitation(input)).toEqual({
      ok: false,
      reason: "consumed",
    })

    sqlMock.mockResolvedValueOnce([])
    expect(await acceptInvitation(input)).toEqual({
      ok: false,
      reason: "unknown",
    })
    expect(setUserPassword).not.toHaveBeenCalled()
  })

  it("no crea nada si el correo ya tiene cuenta", async () => {
    sqlMock
      .mockResolvedValueOnce([liveRow])
      .mockResolvedValueOnce([{ taken: true }])

    expect(await acceptInvitation(input)).toEqual({
      ok: false,
      reason: "email_taken",
    })
    expect(sqlMock).toHaveBeenCalledTimes(2)
    expect(setUserPassword).not.toHaveBeenCalled()
  })

  it("si otro request consumió el token primero, no crea el user", async () => {
    sqlMock
      .mockResolvedValueOnce([liveRow])
      .mockResolvedValueOnce([{ taken: false }])
      // El update condicional no encuentra fila viva.
      .mockResolvedValueOnce([])

    expect(await acceptInvitation(input)).toEqual({
      ok: false,
      reason: "consumed",
    })
    expect(sqlMock).toHaveBeenCalledTimes(3)
    expect(setUserPassword).not.toHaveBeenCalled()
  })
})
