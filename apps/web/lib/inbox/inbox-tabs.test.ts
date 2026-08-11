import { describe, expect, it } from "vitest"

import {
  DEFAULT_INBOX_TAB,
  INBOX_TABS,
  firstParam,
  inboxHref,
  resolveInboxTab,
} from "./inbox-tabs"

describe("resolveInboxTab", () => {
  it("cae en mensajes con cualquier entrada que no sea un modo conocido", () => {
    expect(resolveInboxTab(undefined)).toBe("mensajes")
    expect(resolveInboxTab("")).toBe("mensajes")
    expect(resolveInboxTab("basura")).toBe("mensajes")
    expect(resolveInboxTab([])).toBe("mensajes")
    // Los valores del enum son minúsculas: `?tab=Mensajes` no es un modo.
    expect(resolveInboxTab("Mensajes")).toBe("mensajes")
  })

  it("resuelve el modo válido y se queda con el primero si viene repetido", () => {
    expect(resolveInboxTab("comentarios")).toBe("comentarios")
    expect(resolveInboxTab(["comentarios", "mensajes"])).toBe("comentarios")
  })
})

describe("firstParam", () => {
  it("normaliza las tres formas que entrega Next", () => {
    expect(firstParam(undefined)).toBeUndefined()
    expect(firstParam("uno")).toBe("uno")
    expect(firstParam(["uno", "dos"])).toBe("uno")
    expect(firstParam([])).toBeUndefined()
  })
})

describe("INBOX_TABS", () => {
  it("declara los dos modos en orden, con mensajes por defecto", () => {
    expect(INBOX_TABS.map((tab) => tab.id)).toEqual(["mensajes", "comentarios"])
    expect(INBOX_TABS.map((tab) => tab.label)).toEqual([
      "Mensajes",
      "Comentarios",
    ])
    expect(DEFAULT_INBOX_TAB).toBe("mensajes")
  })
})

describe("inboxHref", () => {
  it("omite el modo por defecto para que /inbox sea la URL canónica", () => {
    expect(inboxHref({})).toBe("/inbox")
    expect(inboxHref({ tab: "mensajes" })).toBe("/inbox")
    expect(inboxHref({ tab: "comentarios" })).toBe("/inbox?tab=comentarios")
  })

  it("conserva el filtro de cuenta en los dos modos", () => {
    expect(inboxHref({ pageId: "page-1" })).toBe("/inbox?page=page-1")
    expect(inboxHref({ tab: "comentarios", pageId: "page-1" })).toBe(
      "/inbox?tab=comentarios&page=page-1"
    )
  })

  it("descarta la selección del otro modo, así ningún enlace queda rancio", () => {
    expect(
      inboxHref({ tab: "mensajes", publicationKey: "page-1:17841400000000000" })
    ).toBe("/inbox")
    expect(inboxHref({ tab: "comentarios", conversationId: "conv-1" })).toBe(
      "/inbox?tab=comentarios"
    )
  })

  it("emite la selección de su propio modo", () => {
    expect(inboxHref({ pageId: "page-1", conversationId: "conv-1" })).toBe(
      "/inbox?page=page-1&conversation=conv-1"
    )
    expect(
      inboxHref({
        tab: "comentarios",
        publicationKey: "page-1:17841400000000000",
      })
    ).toBe("/inbox?tab=comentarios&media=page-1%3A17841400000000000")
  })

  it("ida y vuelta: el enlace que emite la UI resuelve al mismo modo", () => {
    const href = inboxHref({ tab: "comentarios", pageId: "page-1" })
    const params = new URL(href, "https://resender.dev").searchParams

    expect(resolveInboxTab(params.get("tab") ?? undefined)).toBe("comentarios")
    expect(params.get("page")).toBe("page-1")
  })
})
