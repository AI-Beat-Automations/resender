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

// Cuántas páginas puede añadir todavía, en una frase. Se usa en la cabecera de
// `/connections/select` y en el aviso del formulario, para que el mismo dato no
// se redacte dos veces. Sin cupo nombra **la acción** (desconectar), no la
// pantalla: quien llegó desde «Volver a conectar» ya viene de Conexiones
// (ADR 0005).
export function formatPageAllowance(view: PageSelectionView): string {
  if (view.remainingSlots === 0) {
    return "No te queda cupo: desconecta una página para liberar cupo y conectar otra."
  }

  return `Puedes añadir ${view.remainingSlots} ${
    view.remainingSlots === 1 ? "página" : "páginas"
  } más.`
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
          "Esa selección incluye una página que no puedes conectar. Recarga la pantalla e inténtalo de nuevo.",
      }
    }

    if (page.state === "already_connected") continue
    newPages.push({ pageId: page.metaPageId, name: page.name })
  }

  if (newPages.length > input.view.remainingSlots) {
    const { maxPages, activePageCount, remainingSlots } = input.view
    const plan = `Tu plan permite ${maxPages} páginas conectadas y ya tienes ${activePageCount} activas`

    return {
      ok: false,
      code: "page_limit_exceeded",
      message:
        remainingSlots === 0
          ? `${plan}: no te queda cupo. Desconecta una página para liberar cupo y conectar otra.`
          : `${plan}: puedes añadir ${remainingSlots} ${
              remainingSlots === 1 ? "página" : "páginas"
            } más. Desmarca las que sobren o desconecta una página para liberar cupo.`,
    }
  }

  return { ok: true, value: newPages }
}
