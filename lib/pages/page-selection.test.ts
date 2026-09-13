import { describe, expect, it } from "vitest"

import { es } from "@/content/i18n/app/es"

import { ownerScope } from "./connection-scope"
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
  status: PageOwnershipRow["status"] = "active",
  agencyClientId: string | null = null
): PageOwnershipRow => ({
  metaPageId: pageId,
  tenantId,
  agencyClientId,
  status,
})

describe("validatePageSelection para un cliente de agencia", () => {
  it("rechaza el exceso de cupo sin contar los números de la agencia", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b")],
      ownership: [],
      scope: { tenantId: "juan", owner: false, clientId: "pedro" },
      activePageCount: 4,
      maxPages: 5,
    })

    expect(
      validatePageSelection(
        { view, selectedPageIds: ["a", "b"], agencyClient: true },
        es
      )
    ).toEqual({
      ok: false,
      code: "page_limit_exceeded",
      message: es.actions.accountSlotFullAgency,
    })
  })
})

describe("page selection classification", () => {
  // Modo agencia (ADR 0020): la persona de un cliente solo ve como propias las
  // páginas de su cliente. La de otro cliente y la sin asignar del mismo tenant
  // se muestran como de otra cuenta, igual que la de otro tenant.
  it("para un cliente de agencia, solo las páginas de su cliente son suyas", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b"), metaPage("c"), metaPage("d")],
      ownership: [
        ownedBy("a", "juan", "active", "pedro"),
        ownedBy("b", "juan", "active", "maria"),
        ownedBy("c", "juan", "active", null),
      ],
      scope: { tenantId: "juan", owner: false, clientId: "pedro" },
      activePageCount: 3,
      maxPages: 5,
    })

    expect(view.pages.map((page) => page.state)).toEqual([
      "already_connected",
      "owned_by_other_tenant",
      "owned_by_other_tenant",
      "selectable",
    ])
  })

  it("el dueño ve como propias las asignadas y las sin asignar", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b")],
      ownership: [
        ownedBy("a", "juan", "active", "pedro"),
        ownedBy("b", "juan", "active", null),
      ],
      scope: ownerScope("juan"),
      activePageCount: 2,
      maxPages: 5,
    })

    expect(view.pages.map((page) => page.state)).toEqual([
      "already_connected",
      "already_connected",
    ])
  })

  it("keeps the pages free for this tenant selectable when others are taken", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b"), metaPage("c"), metaPage("d")],
      ownership: [ownedBy("a", "arturo"), ownedBy("b", "arturo")],
      scope: ownerScope("felipe"),
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
      validatePageSelection({ view, selectedPageIds: ["c", "d"] }, es)
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
      scope: ownerScope("felipe"),
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
      scope: ownerScope("felipe"),
      activePageCount: 1,
      maxPages: 2,
    })

    expect(view.pages).toEqual([
      { metaPageId: "a", name: "Page a", state: "selectable" },
      { metaPageId: "b", name: "Page b", state: "already_connected" },
      { metaPageId: "c", name: "Page c", state: "selectable" },
    ])
    expect(view.remainingSlots).toBe(1)

    expect(validatePageSelection({ view, selectedPageIds: ["a"] }, es)).toEqual(
      {
        ok: true,
        value: [{ pageId: "a", name: "Page a" }],
      }
    )

    const reconnectAndAdd = validatePageSelection(
      {
        view,
        selectedPageIds: ["a", "c"],
      },
      es
    )
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
      scope: ownerScope("felipe"),
      activePageCount: 0,
      maxPages: 2,
    })

    expect(view.pages.map((page) => page.state)).toEqual([
      "owned_by_other_tenant",
      "owned_by_other_tenant",
    ])

    const result = validatePageSelection({ view, selectedPageIds: ["a"] }, es)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: "invalid_selection" })
  })

  it("rejects a selection that exceeds the remaining slots of the plan", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b"), metaPage("c")],
      ownership: [],
      scope: ownerScope("felipe"),
      activePageCount: 0,
      maxPages: 2,
    })

    const result = validatePageSelection(
      {
        view,
        selectedPageIds: ["a", "b", "c"],
      },
      es
    )

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: "page_limit_exceeded" })
    if (!result.ok) {
      expect(result.message).toBe(
        "Tu plan permite 2 conexiones y ya tienes 0 activas: puedes añadir 2 páginas más. Desmarca las que sobren o desconecta una página para liberar cupo."
      )
    }
  })

  it("marks a page already connected by this tenant and does not count it as new", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a"), metaPage("b")],
      ownership: [ownedBy("a", "felipe")],
      scope: ownerScope("felipe"),
      activePageCount: 1,
      maxPages: 2,
    })

    expect(view.pages[0]).toEqual({
      metaPageId: "a",
      name: "Page a",
      state: "already_connected",
    })

    expect(
      validatePageSelection({ view, selectedPageIds: ["a", "b"] }, es)
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
      scope: ownerScope("felipe"),
      activePageCount,
      maxPages,
    })

  it("names the disconnect action instead of the Connections screen when there is no room left", () => {
    const view = viewWith(2, 2)

    expect(formatPageAllowance(view, es)).toBe(
      "No te queda cupo: desconecta una página para liberar cupo y conectar otra."
    )

    const result = validatePageSelection({ view, selectedPageIds: ["a"] }, es)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe(
        "Tu plan permite 2 conexiones y ya tienes 2 activas: no te queda cupo. Desconecta una página para liberar cupo y conectar otra."
      )
      expect(result.message).not.toMatch(/Conexiones/)
    }
  })

  it("says how many pages can still be added, in singular and plural", () => {
    expect(formatPageAllowance(viewWith(1, 2), es)).toBe(
      "Puedes añadir 1 página más."
    )
    expect(formatPageAllowance(viewWith(0, 3), es)).toBe(
      "Puedes añadir 3 páginas más."
    )
  })

  it("asks to reload when the selection includes a page of another tenant", () => {
    const view = classifyPagesForSelection({
      metaPages: [metaPage("a")],
      ownership: [ownedBy("a", "arturo")],
      scope: ownerScope("felipe"),
      activePageCount: 0,
      maxPages: 2,
    })

    const result = validatePageSelection({ view, selectedPageIds: ["a"] }, es)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe(
        "Esa selección incluye una página que no puedes conectar. Recarga la pantalla e inténtalo de nuevo."
      )
    }
  })
})

describe("checkAccountSlotAvailable", () => {
  // Modo agencia (ADR 0020): el cupo es de la agencia. A la persona de un
  // cliente no se le cuentan números ni se la manda a desconectar.
  it("a un cliente de agencia le habla del plan de su agencia, sin números", () => {
    expect(
      checkAccountSlotAvailable(
        {
          activePageCount: 2,
          maxPages: 2,
          reconnectingActiveAccount: false,
          agencyClient: true,
        },
        es
      )
    ).toEqual({ ok: false, message: es.actions.accountSlotFullAgency })
  })

  it("deja conectar mientras quede hueco", () => {
    expect(
      checkAccountSlotAvailable(
        {
          activePageCount: 1,
          maxPages: 2,
          reconnectingActiveAccount: false,
        },
        es
      )
    ).toEqual({ ok: true })
  })

  it("bloquea la cuenta nueva cuando el cupo está lleno", () => {
    const result = checkAccountSlotAvailable(
      {
        activePageCount: 2,
        maxPages: 2,
        reconnectingActiveAccount: false,
      },
      es
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // El cupo se dice en conexiones (ADR 0011) y nombra la acción.
      expect(result.message).toContain("2 conexiones")
      expect(result.message).toContain("Desconecta")
    }
  })

  it("deja reconectar una cuenta que ya está activa aunque no quede cupo", () => {
    // Reconectar no pide un hueco nuevo: ya ocupa el suyo. Sin esta rama, quien
    // está en el tope no podría renovar el token de lo que ya tiene.
    expect(
      checkAccountSlotAvailable(
        {
          activePageCount: 5,
          maxPages: 2,
          reconnectingActiveAccount: true,
        },
        es
      )
    ).toEqual({ ok: true })
  })

  it("bloquea también cuando ya se pasó del límite", () => {
    expect(
      checkAccountSlotAvailable(
        {
          activePageCount: 3,
          maxPages: 2,
          reconnectingActiveAccount: false,
        },
        es
      ).ok
    ).toBe(false)
  })
})
