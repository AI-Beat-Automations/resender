import { describe, expect, it } from "vitest"

import { connectionsHref } from "./connections-href"

describe("connectionsHref", () => {
  it("deja /connections como URL canónica sin filtro", () => {
    expect(connectionsHref({})).toBe("/connections")
    expect(connectionsHref({ clientFilter: null })).toBe("/connections")
  })

  it("lleva el filtro por cliente en ?cliente=", () => {
    expect(connectionsHref({ clientFilter: "client-1" })).toBe(
      "/connections?cliente=client-1"
    )
    expect(connectionsHref({ clientFilter: "propias" })).toBe(
      "/connections?cliente=propias"
    )
  })
})
