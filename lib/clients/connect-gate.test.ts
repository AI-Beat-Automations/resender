import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveActorByUserId: vi.fn(),
  isUserWaitlisted: vi.fn(),
  hasActiveSubscription: vi.fn(),
}))

vi.mock("./actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actor")>()),
  resolveActorByUserId: mocks.resolveActorByUserId,
}))
vi.mock("@/lib/auth/waitlist", () => ({
  isUserWaitlisted: mocks.isUserWaitlisted,
}))
vi.mock("@/lib/billing/subscription", () => ({
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

import { resolveConnectGate } from "./connect-gate"

const parent = { tenantId: "tenant-1", userId: "tenant-1", clientAccountId: null }
const client = {
  tenantId: "tenant-1",
  userId: "user-2",
  clientAccountId: "client-1",
}

describe("resolveConnectGate", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
  })

  it("el padre pasa por lista de espera y suscripción, como siempre", async () => {
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: parent })

    await expect(resolveConnectGate("tenant-1")).resolves.toEqual({
      kind: "ok",
      actor: parent,
    })
    expect(mocks.isUserWaitlisted).toHaveBeenCalledWith("tenant-1")
    expect(mocks.hasActiveSubscription).toHaveBeenCalledWith("tenant-1")
  })

  it("el padre en lista de espera no conecta", async () => {
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: parent })
    mocks.isUserWaitlisted.mockResolvedValue(true)

    await expect(resolveConnectGate("tenant-1")).resolves.toEqual({
      kind: "waitlisted",
    })
  })

  it("el padre sin suscripción va a facturación", async () => {
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: parent })
    mocks.hasActiveSubscription.mockResolvedValue(false)

    await expect(resolveConnectGate("tenant-1")).resolves.toEqual({
      kind: "no_active_subscription",
    })
  })

  // El cliente salta la lista de espera y su suscripción es la del padre: se
  // consulta con el `tenantId` heredado, no con su propio user.
  it("el cliente conecta con la suscripción del padre y sin lista de espera", async () => {
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: client })

    await expect(resolveConnectGate("user-2")).resolves.toEqual({
      kind: "ok",
      actor: client,
    })
    expect(mocks.isUserWaitlisted).not.toHaveBeenCalled()
    expect(mocks.hasActiveSubscription).toHaveBeenCalledWith("tenant-1")
  })

  it("el cliente cuyo padre no paga queda restringido, nunca en facturación", async () => {
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "actor", actor: client })
    mocks.hasActiveSubscription.mockResolvedValue(false)

    await expect(resolveConnectGate("user-2")).resolves.toEqual({
      kind: "client_restricted",
    })
  })

  it("un cliente pendiente y un user desconocido cierran la puerta", async () => {
    mocks.resolveActorByUserId.mockResolvedValue({ kind: "client_pending" })
    await expect(resolveConnectGate("user-2")).resolves.toEqual({
      kind: "client_restricted",
    })

    mocks.resolveActorByUserId.mockResolvedValue({ kind: "unknown_user" })
    await expect(resolveConnectGate("ghost")).resolves.toEqual({
      kind: "not_authenticated",
    })
    expect(mocks.hasActiveSubscription).not.toHaveBeenCalled()
  })
})
