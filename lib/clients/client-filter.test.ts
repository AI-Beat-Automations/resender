import { describe, expect, it } from "vitest"

import {
  ALL_CLIENTS_FILTER,
  CLIENT_FILTER_PARAM,
  OWN_CLIENT_FILTER,
  clientFilterParam,
  clientFilterPredicate,
  matchesClientFilter,
  resolveClientFilter,
} from "./client-filter"

const PARENT = { clientAccountId: null }
const CLIENT = { clientAccountId: "client-1" }
const CLIENTS = [
  { id: "client-1", name: "Café Rioja" },
  { id: "client-2", name: "Dental Sur" },
]

describe("resolveClientFilter", () => {
  it("sin parámetro es «todo»", () => {
    expect(resolveClientFilter(undefined, CLIENTS, PARENT)).toEqual({
      kind: "all",
    })
    expect(resolveClientFilter("", CLIENTS, PARENT)).toEqual({ kind: "all" })
    expect(resolveClientFilter([], CLIENTS, PARENT)).toEqual({ kind: "all" })
  })

  it("resuelve un cliente del tenant y se queda con el primero si viene repetido", () => {
    expect(resolveClientFilter("client-2", CLIENTS, PARENT)).toEqual({
      kind: "client",
      clientAccountId: "client-2",
    })
    expect(
      resolveClientFilter(["client-1", "client-2"], CLIENTS, PARENT)
    ).toEqual({ kind: "client", clientAccountId: "client-1" })
  })

  it("descarta en silencio un id que no es de un cliente del tenant", () => {
    // Un id ajeno o inventado no es un 404: la pantalla se ve sin filtro.
    expect(resolveClientFilter("client-9", CLIENTS, PARENT)).toEqual({
      kind: "all",
    })
    expect(resolveClientFilter("client-1", [], PARENT)).toEqual({
      kind: "all",
    })
  })

  it("reconoce el valor de «solo las propias»", () => {
    expect(resolveClientFilter(OWN_CLIENT_FILTER, CLIENTS, PARENT)).toEqual({
      kind: "own",
    })
  })

  it("para un actor cliente el parámetro no hace nada", () => {
    // El alcance del cliente lo decide el actor; `?cliente=` no puede
    // ampliarlo ni moverlo a otro cliente.
    expect(resolveClientFilter("client-2", CLIENTS, CLIENT)).toEqual({
      kind: "all",
    })
    expect(resolveClientFilter(OWN_CLIENT_FILTER, CLIENTS, CLIENT)).toEqual({
      kind: "all",
    })
  })
})

describe("clientFilterParam", () => {
  it("ida y vuelta con resolveClientFilter", () => {
    for (const filter of [
      ALL_CLIENTS_FILTER,
      { kind: "own" as const },
      { kind: "client" as const, clientAccountId: "client-2" },
    ]) {
      const param = clientFilterParam(filter)
      expect(resolveClientFilter(param ?? undefined, CLIENTS, PARENT)).toEqual(
        filter
      )
    }
    expect(clientFilterParam(ALL_CLIENTS_FILTER)).toBeNull()
    expect(CLIENT_FILTER_PARAM).toBe("cliente")
  })
})

describe("matchesClientFilter", () => {
  it.each([
    [{ kind: "all" as const }, null, true],
    [{ kind: "all" as const }, "client-1", true],
    [{ kind: "own" as const }, null, true],
    [{ kind: "own" as const }, "client-1", false],
    [{ kind: "client" as const, clientAccountId: "client-1" }, "client-1", true],
    [{ kind: "client" as const, clientAccountId: "client-1" }, "client-2", false],
    [{ kind: "client" as const, clientAccountId: "client-1" }, null, false],
  ])("%o con %s → %s", (filter, clientAccountId, expected) => {
    expect(matchesClientFilter(filter, clientAccountId)).toBe(expected)
  })
})

describe("clientFilterPredicate", () => {
  it("traduce el filtro a los dos parámetros del SQL", () => {
    expect(clientFilterPredicate(undefined)).toEqual({
      own: false,
      clientAccountId: null,
    })
    expect(clientFilterPredicate({ kind: "all" })).toEqual({
      own: false,
      clientAccountId: null,
    })
    expect(clientFilterPredicate({ kind: "own" })).toEqual({
      own: true,
      clientAccountId: null,
    })
    expect(
      clientFilterPredicate({ kind: "client", clientAccountId: "client-1" })
    ).toEqual({ own: false, clientAccountId: "client-1" })
  })
})
