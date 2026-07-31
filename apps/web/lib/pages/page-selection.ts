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

export function formatPageAllowance(view: PageSelectionView): string {
  if (view.remainingSlots === 0) {
    return "No te queda cupo: desconecta una página para liberar cupo y conectar otra."
  }

  return `Puedes añadir ${view.remainingSlots} ${
    view.remainingSlots === 1 ? "página" : "páginas"
  } más.`
}
