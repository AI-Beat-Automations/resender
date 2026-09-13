import { describe, expect, it } from "vitest"

import { ownerScope, scopeOf, scopeOwnsRow } from "./connection-scope"

const TENANT = "tenant-juan"
const OTHER_TENANT = "tenant-otra"
const PEDRO_CLIENT = "client-pedro"
const MARIA_CLIENT = "client-maria"

const pedroScope = scopeOf({
  kind: "client",
  userId: "user-pedro",
  tenantId: TENANT,
  clientId: PEDRO_CLIENT,
  clientName: "Panadería Pedro",
})

describe("scopeOf", () => {
  it("el dueño ve todo su tenant", () => {
    expect(
      scopeOf({ kind: "owner", userId: TENANT, tenantId: TENANT })
    ).toEqual({ tenantId: TENANT, owner: true, clientId: null })
  })

  it("la persona de un cliente queda acotada a su cliente", () => {
    expect(pedroScope).toEqual({
      tenantId: TENANT,
      owner: false,
      clientId: PEDRO_CLIENT,
    })
  })
})

describe("scopeOwnsRow", () => {
  it("el dueño toca asignadas y sin asignar de su tenant", () => {
    const scope = ownerScope(TENANT)
    expect(
      scopeOwnsRow({ tenantId: TENANT, agencyClientId: null }, scope)
    ).toBe(true)
    expect(
      scopeOwnsRow({ tenantId: TENANT, agencyClientId: MARIA_CLIENT }, scope)
    ).toBe(true)
  })

  it("nadie toca conexiones de otro tenant", () => {
    expect(
      scopeOwnsRow(
        { tenantId: OTHER_TENANT, agencyClientId: null },
        ownerScope(TENANT)
      )
    ).toBe(false)
    expect(
      scopeOwnsRow(
        { tenantId: OTHER_TENANT, agencyClientId: PEDRO_CLIENT },
        pedroScope
      )
    ).toBe(false)
  })

  it("un cliente solo toca las suyas: ni las de otro ni las sin asignar", () => {
    expect(
      scopeOwnsRow(
        { tenantId: TENANT, agencyClientId: PEDRO_CLIENT },
        pedroScope
      )
    ).toBe(true)
    expect(
      scopeOwnsRow(
        { tenantId: TENANT, agencyClientId: MARIA_CLIENT },
        pedroScope
      )
    ).toBe(false)
    expect(
      scopeOwnsRow({ tenantId: TENANT, agencyClientId: null }, pedroScope)
    ).toBe(false)
  })
})
