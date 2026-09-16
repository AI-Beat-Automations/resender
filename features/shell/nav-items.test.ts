import { describe, expect, it } from "vitest"

import { productNavItems } from "./nav-items"

describe("productNavItems", () => {
  it("mete «Clientes» entre Inbox y Ajustes solo para quien puede invitar", () => {
    expect(productNavItems({ showClients: true }).map((i) => i.href)).toEqual([
      "/connections",
      "/inbox",
      "/clientes",
      "/settings",
      "/docs",
    ])
    expect(productNavItems({ showClients: false }).map((i) => i.href)).toEqual([
      "/connections",
      "/inbox",
      "/settings",
      "/docs",
    ])
  })

  it("la documentación sigue siendo el único destino externo", () => {
    const external = productNavItems({ showClients: true }).filter(
      (i) => i.external
    )
    expect(external.map((i) => i.href)).toEqual(["/docs"])
  })
})
