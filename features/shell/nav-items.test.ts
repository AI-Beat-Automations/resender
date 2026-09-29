import { describe, expect, it } from "vitest"

import { productNavItems } from "./nav-items"

const hrefs = (items: ReturnType<typeof productNavItems>) =>
  items.map((i) => i.href)

describe("productNavItems", () => {
  it("mete «Clientes» entre Inbox y Ajustes solo para quien puede invitar", () => {
    expect(
      hrefs(productNavItems({ showClients: true, isClient: false }))
    ).toEqual([
      "/connections",
      "/inbox",
      "/templates",
      "/logs",
      "/clientes",
      "/settings",
      "/docs",
    ])
    expect(
      hrefs(productNavItems({ showClients: false, isClient: false }))
    ).toEqual([
      "/connections",
      "/inbox",
      "/templates",
      "/logs",
      "/settings",
      "/docs",
    ])
  })

  it("el cliente ve solo Conexiones, Inbox, Plantillas y Ajustes, aunque el plan del padre invite", () => {
    expect(
      hrefs(productNavItems({ showClients: true, isClient: true }))
    ).toEqual(["/connections", "/inbox", "/templates", "/settings"])
    expect(
      productNavItems({ showClients: true, isClient: true }).some(
        (i) => i.external
      )
    ).toBe(false)
  })

  it("«Plantillas» aparece para el padre y para el cliente", () => {
    for (const visibility of [
      { showClients: false, isClient: false },
      { showClients: true, isClient: false },
      { showClients: true, isClient: true },
    ]) {
      expect(productNavItems(visibility)).toContainEqual({
        href: "/templates",
        label: "navTemplates",
      })
    }
  })

  it("la documentación sigue siendo el único destino externo del padre", () => {
    const external = productNavItems({
      showClients: true,
      isClient: false,
    }).filter((i) => i.external)
    expect(external.map((i) => i.href)).toEqual(["/docs"])
  })
})
