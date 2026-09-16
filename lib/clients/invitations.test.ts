import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }))

vi.mock("@/lib/db", () => ({ getSql: () => sqlMock }))

import { hashInvitationToken } from "./invitation-token"
import {
  cancelPendingInvitations,
  isInvitationLive,
  issueInvitation,
} from "./invitations"

// Mismo patrón `sqlMock` que `password-reset.test.ts`: se comprueba la
// consulta emitida y lo que se guarda, no la forma interna.
function queryText(call: unknown[]): string {
  return (call[0] as string[]).join("")
}

describe("issueInvitation", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    // Primera llamada: el update de cancelación. Segunda: el insert.
    sqlMock
      .mockResolvedValueOnce([{ id: "old-1" }])
      .mockResolvedValueOnce([{ id: "inv-2" }])
  })

  it("guarda solo el hash, con vencimiento a 7 días, y devuelve el token", async () => {
    const now = new Date("2026-09-16T10:00:00Z")
    const issued = await issueInvitation({
      clientAccountId: "client-1",
      email: "cliente@example.com",
      now,
    })

    expect(issued.id).toBe("inv-2")
    expect(issued.email).toBe("cliente@example.com")
    expect(issued.expiresAt.toISOString()).toBe("2026-09-23T10:00:00.000Z")

    const insert = sqlMock.mock.calls[1]!
    const [, ...params] = insert
    expect(queryText(insert)).toContain("insert into client_invitations")
    expect(params).toContain(hashInvitationToken(issued.token))
    expect(params).not.toContain(issued.token)
    expect(params).toContain("2026-09-23T10:00:00.000Z")
  })

  it("cancela las invitaciones vivas del cliente antes de insertar la nueva", async () => {
    await issueInvitation({
      clientAccountId: "client-1",
      email: "cliente@example.com",
    })

    const cancel = sqlMock.mock.calls[0]!
    const text = queryText(cancel)
    expect(text).toContain("update client_invitations")
    expect(text).toContain("set cancelled_at = now()")
    expect(text).toContain("accepted_at is null")
    expect(cancel).toContain("client-1")
    expect(queryText(sqlMock.mock.calls[1]!)).toContain("insert into")
  })
})

describe("cancelPendingInvitations", () => {
  it("devuelve cuántas quedaron canceladas", async () => {
    sqlMock.mockReset()
    sqlMock.mockResolvedValue([{ id: "a" }, { id: "b" }])
    expect(await cancelPendingInvitations("client-1")).toBe(2)
  })
})

describe("isInvitationLive", () => {
  const now = new Date("2026-09-16T10:00:00Z")
  const base = {
    id: "inv",
    email: "x@example.com",
    expiresAt: new Date("2026-09-20T10:00:00Z"),
    acceptedAt: null,
    cancelledAt: null,
  }

  it("vive si no se aceptó, no se canceló y no venció", () => {
    expect(isInvitationLive(base, now)).toBe(true)
  })

  it("no vive si se aceptó, se canceló, venció o no existe", () => {
    expect(isInvitationLive({ ...base, acceptedAt: now }, now)).toBe(false)
    expect(isInvitationLive({ ...base, cancelledAt: now }, now)).toBe(false)
    expect(
      isInvitationLive(
        { ...base, expiresAt: new Date("2026-09-10T10:00:00Z") },
        now
      )
    ).toBe(false)
    expect(isInvitationLive(null, now)).toBe(false)
  })
})
