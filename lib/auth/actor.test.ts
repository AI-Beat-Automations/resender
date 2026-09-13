import { describe, expect, it } from "vitest"

import { decideActor, type ActorRow } from "./actor"

const OWNER = "00000000-0000-0000-0000-00000000000a"
const PEDRO = "00000000-0000-0000-0000-00000000000b"
const CLIENT = "00000000-0000-0000-0000-00000000000c"

function ownerRow(overrides: Partial<ActorRow> = {}): ActorRow {
  return {
    user_id: OWNER,
    waitlisted: false,
    agency_client_id: null,
    member_tenant_id: null,
    client_name: null,
    tenant_waitlisted: null,
    ...overrides,
  }
}

function clientRow(overrides: Partial<ActorRow> = {}): ActorRow {
  return {
    user_id: PEDRO,
    waitlisted: false,
    agency_client_id: CLIENT,
    member_tenant_id: OWNER,
    client_name: "Panadería Pedro",
    tenant_waitlisted: false,
    ...overrides,
  }
}

describe("decideActor", () => {
  it("una cuenta sin membresía es dueña de su propio tenant", () => {
    expect(decideActor(ownerRow())).toEqual({
      status: "ok",
      actor: { kind: "owner", userId: OWNER, tenantId: OWNER },
    })
  })

  it("la persona de un cliente opera en el tenant de la agencia", () => {
    expect(decideActor(clientRow())).toEqual({
      status: "ok",
      actor: {
        kind: "client",
        userId: PEDRO,
        tenantId: OWNER,
        clientId: CLIENT,
        clientName: "Panadería Pedro",
      },
    })
  })

  it("sin fila es una sesión huérfana", () => {
    expect(decideActor(null)).toEqual({ status: "unknown_user" })
    expect(decideActor(undefined)).toEqual({ status: "unknown_user" })
  })

  it("el gate de acceso de la persona manda, sea dueña o cliente", () => {
    expect(decideActor(ownerRow({ waitlisted: true }))).toEqual({
      status: "waitlisted",
    })
    expect(decideActor(clientRow({ waitlisted: true }))).toEqual({
      status: "waitlisted",
    })
    expect(decideActor(ownerRow({ waitlisted: null }))).toEqual({
      status: "waitlisted",
    })
  })

  it("una agencia con el gate cerrado deja afuera a sus clientes", () => {
    expect(decideActor(clientRow({ tenant_waitlisted: true }))).toEqual({
      status: "agency_unavailable",
    })
    expect(decideActor(clientRow({ tenant_waitlisted: null }))).toEqual({
      status: "agency_unavailable",
    })
  })

  // Una membresía a medias nunca degrada a dueño: esa persona no tiene tenant
  // propio y la vería vacía, o peor, operaría sobre su propio uuid.
  it("una membresía a medias falla cerrada, no se vuelve dueña", () => {
    expect(decideActor(clientRow({ client_name: null }))).toEqual({
      status: "agency_unavailable",
    })
    expect(decideActor(clientRow({ member_tenant_id: null }))).toEqual({
      status: "agency_unavailable",
    })
    expect(decideActor(clientRow({ agency_client_id: null }))).toEqual({
      status: "agency_unavailable",
    })
  })
})
