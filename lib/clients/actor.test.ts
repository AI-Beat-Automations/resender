import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }))

vi.mock("@/lib/db", () => ({ getSql: () => sqlMock }))

import { decideActor, resolveActor } from "./actor"

// Mismo patrón `sqlMock` que `password-reset.test.ts`: se comprueba la
// decisión a partir de la fila y la consulta emitida, no la forma interna.
const session = { user: { id: "user-1", email: "x@example.com", name: "" } }

describe("decideActor", () => {
  it("el padre no tiene fila de cliente: es su propio tenant", () => {
    expect(
      decideActor({
        user_id: "user-1",
        client_account_id: null,
        tenant_id: null,
        client_status: null,
      })
    ).toEqual({
      kind: "actor",
      actor: { tenantId: "user-1", userId: "user-1", clientAccountId: null },
    })
  })

  it("el cliente activo hereda el tenant del padre", () => {
    expect(
      decideActor({
        user_id: "user-1",
        client_account_id: "client-9",
        tenant_id: "parent-7",
        client_status: "active",
      })
    ).toEqual({
      kind: "actor",
      actor: {
        tenantId: "parent-7",
        userId: "user-1",
        clientAccountId: "client-9",
      },
    })
  })

  it("el cliente pendiente no tiene acceso", () => {
    expect(
      decideActor({
        user_id: "user-1",
        client_account_id: "client-9",
        tenant_id: "parent-7",
        client_status: "pending",
      })
    ).toEqual({ kind: "client_pending" })
  })

  it("sin fila, el user no existe (fail closed)", () => {
    expect(decideActor(undefined)).toEqual({ kind: "unknown_user" })
    expect(decideActor(null)).toEqual({ kind: "unknown_user" })
  })
})

describe("resolveActor", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    sqlMock.mockResolvedValue([])
  })

  it("lee users y client_accounts por el id de la sesión, nunca de la cookie", async () => {
    sqlMock.mockResolvedValue([
      {
        user_id: "user-1",
        client_account_id: "client-9",
        tenant_id: "parent-7",
        client_status: "active",
      },
    ])

    const resolution = await resolveActor(session)

    expect(resolution).toEqual({
      kind: "actor",
      actor: {
        tenantId: "parent-7",
        userId: "user-1",
        clientAccountId: "client-9",
      },
    })
    const [strings, ...params] = sqlMock.mock.calls[0]!
    const query = (strings as string[]).join("")
    expect(query).toContain("from users")
    expect(query).toContain("client_accounts")
    expect(params).toEqual(["user-1"])
  })

  it("responde unknown_user cuando la consulta no devuelve nada", async () => {
    expect(await resolveActor(session)).toEqual({ kind: "unknown_user" })
  })
})
