import { describe, expect, it } from "vitest"

import {
  checkAccountSlotAvailable,
  classifyPagesForSelection,
  formatPageAllowance,
  validatePageSelection,
  type PageOwnershipRow,
} from "./page-selection"

const metaPage = (pageId: string) => ({ pageId, name: `Page ${pageId}` })

const ownedBy = (
  pageId: string,
  tenantId: string,
  status: PageOwnershipRow["status"] = "active"
): PageOwnershipRow => ({ metaPageId: pageId, tenantId, status })

describe("page selection classification", () => {
  it("keeps the pages free for this tenant selectable when others are taken", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b"), metaPage("c"), metaPage("d")],
      ownership: [ownedBy("a", "arturo"), ownedBy("b", "arturo")],
      tenantId: "felipe",
      activePageCount: 0,
      maxPages: 2,
    })

    expect(view.pages).toEqual([
      { metaPageId: "a", name: "Page a", state: "owned_by_other_tenant" },
      { metaPageId: "b", name: "Page b", state: "owned_by_other_tenant" },
      { metaPageId: "c", name: "Page c", state: "selectable" },
      { metaPageId: "d", name: "Page d", state: "selectable" },
    ])

    expect(
      validatePageSelection({ view, selectedPageIds: ["c", "d"] })
    ).toEqual({
      ok: true,
      value: [
        { pageId: "c", name: "Page c" },
        { pageId: "d", name: "Page d" },
      ],
    })
  })

  it("computes the remaining slots against the already connected active pages", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b")],
      ownership: [ownedBy("a", "felipe")],
      tenantId: "felipe",
      activePageCount: 1,
      maxPages: 2,
    })

    expect(view.remainingSlots).toBe(1)
    expect(view.activePageCount).toBe(1)
    expect(view.maxPages).toBe(2)
  })

  it("does not count disconnected pages against the cap but charges a slot to reconnect them", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b"), metaPage("c")],
      ownership: [
        ownedBy("a", "felipe", "disconnected"),
        ownedBy("b", "felipe"),
      ],
      tenantId: "felipe",
      activePageCount: 1,
      maxPages: 2,
    })

    expect(view.pages).toEqual([
      { metaPageId: "a", name: "Page a", state: "selectable" },
      { metaPageId: "b", name: "Page b", state: "already_connected" },
      { metaPageId: "c", name: "Page c", state: "selectable" },
    ])
    expect(view.remainingSlots).toBe(1)

    expect(validatePageSelection({ view, selectedPageIds: ["a"] })).toEqual({
      ok: true,
      value: [{ pageId: "a", name: "Page a" }],
    })

    const reconnectAndAdd = validatePageSelection({
      view,
      selectedPageIds: ["a", "c"],
    })
    expect(reconnectAndAdd.ok).toBe(false)
    expect(reconnectAndAdd).toMatchObject({ code: "page_limit_exceeded" })
  })

  it("disables every page when the whole list belongs to another tenant", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b")],
      ownership: [
        ownedBy("a", "arturo"),
        ownedBy("b", "arturo", "disconnected"),
      ],
      tenantId: "felipe",
      activePageCount: 0,
      maxPages: 2,
    })

    expect(view.pages.map((page) => page.state)).toEqual([
      "owned_by_other_tenant",
      "owned_by_other_tenant",
    ])

    const result = validatePageSelection({ view, selectedPageIds: ["a"] })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: "invalid_selection" })
  })

  it("rejects a selection that exceeds the remaining slots of the plan", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b"), metaPage("c")],
      ownership: [],
      tenantId: "felipe",
      activePageCount: 0,
      maxPages: 2,
    })

    const result = validatePageSelection({
      view,
      selectedPageIds: ["a", "b", "c"],
    })

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: "page_limit_exceeded" })
    if (!result.ok) {
      expect(result.message).toBe(
        "Tu plan permite 2 páginas conectadas y ya tienes 0 activas: puedes añadir 2 páginas más. Desmarca las que sobren o desconecta una página para liberar cupo."
      )
    }
  })

  it("marks a page already connected by this tenant and does not count it as new", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b")],
      ownership: [ownedBy("a", "felipe")],
      tenantId: "felipe",
      activePageCount: 1,
      maxPages: 2,
    })

    expect(view.pages[0]).toEqual({
      metaPageId: "a",
      name: "Page a",
      state: "already_connected",
    })

    expect(
      validatePageSelection({ view, selectedPageIds: ["a", "b"] })
    ).toEqual({
      ok: true,
      value: [{ pageId: "b", name: "Page b" }],
    })
  })
})

// Copy en español (ADR 0005). El caso sin cupo tiene que nombrar la acción
// —desconectar una página— y no la pantalla de Conexiones.
describe("page selection copy", () => {
  const viewWith = (activePageCount: number, maxPages: number) =>
    classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b"), metaPage("c")],
      ownership: [],
      tenantId: "felipe",
      activePageCount,
      maxPages,
    })

  it("names the disconnect action instead of the Connections screen when there is no room left", () => {
    const view = viewWith(2, 2)

    expect(formatPageAllowance(view)).toBe(
      "No te queda cupo: desconecta una página para liberar cupo y conectar otra."
    )

    const result = validatePageSelection({ view, selectedPageIds: ["a"] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe(
        "Tu plan permite 2 páginas conectadas y ya tienes 2 activas: no te queda cupo. Desconecta una página para liberar cupo y conectar otra."
      )
      expect(result.message).not.toMatch(/Conexiones/)
    }
  })

  it("says how many pages can still be added, in singular and plural", () => {
    expect(formatPageAllowance(viewWith(1, 2))).toBe(
      "Puedes añadir 1 página más."
    )
    expect(formatPageAllowance(viewWith(0, 3))).toBe(
      "Puedes añadir 3 páginas más."
    )
  })

  it("asks to reload when the selection includes a page of another tenant", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a")],
      ownership: [ownedBy("a", "arturo")],
      tenantId: "felipe",
      activePageCount: 0,
      maxPages: 2,
    })

    const result = validatePageSelection({ view, selectedPageIds: ["a"] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe(
        "Esa selección incluye una página que no puedes conectar. Recarga la pantalla e inténtalo de nuevo."
      )
    }
  })
})

// El cupo para un canal que conecta una cuenta por autorización (WhatsApp). Es
// el mismo límite que mide `validatePageSelection` para Messenger, con la
// diferencia de que acá no hay lista que marcar: o entra una, o no entra.
describe("account slot for single-account channels", () => {
  it("lets a new account in while the plan has room", () => {
    expect(
      checkAccountSlotAvailable({
        activePageCount: 1,
        maxPages: 2,
        reconnectingActiveAccount: false,
      })
    ).toEqual({ ok: true })
  })

  // El caso que dejaba mudo a Messenger: el tenant tenía 2 páginas de Facebook
  // en un plan de 2 y conectaba un número de WhatsApp igual. `countActivePages`
  // pasaba a 3 > 2 y el entitlement entero caía en `page_limit_exceeded`, así
  // que sus mensajes de Messenger se seguían cobrando y dejaban de entregarse.
  it("refuses a new account when every slot is taken, naming the way out", () => {
    const result = checkAccountSlotAvailable({
      activePageCount: 2,
      maxPages: 2,
      reconnectingActiveAccount: false,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Nombra las dos cosas que cuentan y la acción que libera el hueco: quien
      // lee «no se pudo conectar» a secas no sabe que la salida es desconectar.
      expect(result.message).toBe(
        "Tu plan permite 2 páginas de Facebook y números de WhatsApp conectados, y ya tienes 2 activos. Desconecta uno en Conexiones para liberar un hueco y vuelve a lanzar la conexión."
      )
    }
  })

  // Reconectar no pide un hueco nuevo: ya ocupa el suyo. Sin esta excepción,
  // quien está al límite no podría renovarle el token a una cuenta que ya tiene.
  it("always lets an already active account reconnect", () => {
    expect(
      checkAccountSlotAvailable({
        activePageCount: 2,
        maxPages: 2,
        reconnectingActiveAccount: true,
      })
    ).toEqual({ ok: true })
  })

  // Una cuenta desconectada no ocupa cupo, así que volver a conectarla consume
  // un slot igual que una nueva (mismo criterio que `page-selection`).
  it("treats a disconnected account as a new one", () => {
    expect(
      checkAccountSlotAvailable({
        activePageCount: 2,
        maxPages: 2,
        reconnectingActiveAccount: false,
      }).ok
    ).toBe(false)
  })

  // Ya pasado del límite (bajó de plan, por ejemplo): sigue sin poder conectar.
  it("keeps refusing when the tenant is already over the limit", () => {
    expect(
      checkAccountSlotAvailable({
        activePageCount: 5,
        maxPages: 2,
        reconnectingActiveAccount: false,
      }).ok
    ).toBe(false)
  })
})
