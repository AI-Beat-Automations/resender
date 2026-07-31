import { describe, expect, it } from "vitest"

import { formatPageAllowance, type PageSelectionView } from "./page-selection"

describe("page selection copy", () => {
  it("names the disconnect action when there is no room left", () => {
    expect(formatPageAllowance(viewWith(2, 2))).toBe(
      "No te queda cupo: desconecta una página para liberar cupo y conectar otra."
    )
  })

  it("says how many Pages can still be added in singular and plural", () => {
    expect(formatPageAllowance(viewWith(1, 2))).toBe(
      "Puedes añadir 1 página más."
    )
    expect(formatPageAllowance(viewWith(0, 3))).toBe(
      "Puedes añadir 3 páginas más."
    )
  })
})

function viewWith(
  activePageCount: number,
  maxPages: number
): PageSelectionView {
  return {
    pages: [],
    activePageCount,
    maxPages,
    remainingSlots: Math.max(0, maxPages - activePageCount),
  }
}
