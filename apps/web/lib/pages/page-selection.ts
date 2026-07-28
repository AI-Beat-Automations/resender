import type { PageStatus } from "./page-registry"

// Módulo puro de selección de páginas (ADR 0004). Sin base de datos, sin red:
// recibe la lista que devolvió Meta, las filas de ownership que matchean esos
// ids y el cupo del plan, y devuelve la clasificación página por página. El
// ownership se evalúa **por página**: que una esté tomada por otro tenant ya no
// invalida el resto de la lista (ese era el bug que motivó el ADR).

export type MetaPageSummary = { pageId: string; name: string }

// Filas de `connected_pages` que matchean los meta_page_id de la lista de Meta
// (de cualquier tenant, en cualquier estado).
export type PageOwnershipRow = {
  metaPageId: string
  tenantId: string
  status: PageStatus
}

export type SelectablePageState =
  | "selectable"
  | "already_connected"
  | "owned_by_other_tenant"

export type SelectablePage = {
  metaPageId: string
  name: string
  state: SelectablePageState
}

export type PageSelectionView = {
  pages: SelectablePage[]
  maxPages: number
  activePageCount: number
  remainingSlots: number
}

export function classifyPagesForSelection(input: {
  metaPages: MetaPageSummary[]
  ownership: PageOwnershipRow[]
  tenantId: string
  // Páginas `active` del tenant; puede incluir páginas que no están en
  // `metaPages` (el usuario dejó de administrarlas en Meta pero siguen
  // ocupando cupo hasta que las desconecte).
  activePageCount: number
  maxPages: number
}): PageSelectionView {
  const byPageId = new Map<string, PageOwnershipRow>()
  for (const row of input.ownership) {
    if (!byPageId.has(row.metaPageId)) byPageId.set(row.metaPageId, row)
  }

  const pages = input.metaPages.map<SelectablePage>((page) => ({
    metaPageId: page.pageId,
    name: page.name,
    state: resolveState(byPageId.get(page.pageId), input.tenantId),
  }))

  return {
    pages,
    maxPages: input.maxPages,
    activePageCount: input.activePageCount,
    remainingSlots: Math.max(0, input.maxPages - input.activePageCount),
  }
}

// Una página `disconnected` del mismo tenant vuelve a ser seleccionable: no
// ocupa cupo mientras está desconectada, pero reconectarla consume un slot
// igual que conectar una nueva.
function resolveState(
  row: PageOwnershipRow | undefined,
  tenantId: string
): SelectablePageState {
  if (!row) return "selectable"
  if (row.tenantId !== tenantId) return "owned_by_other_tenant"
  return row.status === "active" ? "already_connected" : "selectable"
}

export type PageSelectionResult =
  | { ok: true; value: MetaPageSummary[] }
  | {
      ok: false
      code: "page_limit_exceeded" | "invalid_selection"
      message: string
    }

// Devuelve solo las conexiones genuinamente nuevas. Marcar una página que ya
// está conectada por este tenant es válido y simplemente no cuenta como nueva
// (la pantalla solo agrega: desmarcar no desconecta).
export function validatePageSelection(input: {
  view: PageSelectionView
  selectedPageIds: string[]
}): PageSelectionResult {
  const byPageId = new Map(
    input.view.pages.map((page) => [page.metaPageId, page])
  )

  const newPages: MetaPageSummary[] = []
  for (const pageId of new Set(input.selectedPageIds)) {
    const page = byPageId.get(pageId)
    if (!page || page.state === "owned_by_other_tenant") {
      return {
        ok: false,
        code: "invalid_selection",
        message:
          "That selection includes a Page you can't connect. Reload the page and try again.",
      }
    }

    if (page.state === "already_connected") continue
    newPages.push({ pageId: page.metaPageId, name: page.name })
  }

  if (newPages.length > input.view.remainingSlots) {
    return {
      ok: false,
      code: "page_limit_exceeded",
      message: `Your plan allows ${input.view.maxPages} connected Pages and you already have ${input.view.activePageCount} active, so you can add ${input.view.remainingSlots} more. Disconnect Pages in Connections to free slots.`,
    }
  }

  return { ok: true, value: newPages }
}
