import { fmt, type AppDict } from "@/content/i18n/app"

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
export function formatPageAllowance(
  view: PageSelectionView,
  t: AppDict
): string {
  if (view.remainingSlots === 0) return t.select.allowanceNone

  return fmt(
    view.remainingSlots === 1 ? t.select.allowanceOne : t.select.allowanceMany,
    { count: view.remainingSlots }
  )
}

// Cupo del plan para un canal que conecta **una cuenta por autorización**:
// WhatsApp hoy, y cualquier otro que entre por un diálogo sin pantalla de
// selección. Messenger no lo usa —allá el usuario marca varias a la vez y el que
// decide es `validatePageSelection`, que además tiene que contar cuántas de las
// marcadas son nuevas—, pero el texto sale del mismo sitio a propósito: es el
// mismo límite, y contarlo dos veces con dos redacciones es cómo empiezan a no
// coincidir.
//
// Sin esta puerta, el Embedded Signup de WhatsApp escribe la fila igual y el
// tenant termina con más cuentas activas que su plan. El daño no se ve en la
// pantalla de Conexiones: `countActivePages` pasa a superar el límite, el
// entitlement entero cae en `page_limit_exceeded` (ADR 0003) y **las páginas de
// Messenger que ya funcionaban dejan de entregar** —se siguen persistiendo y
// contando, pero no se reenvían— y `/api/meta/send` empieza a responder 403.
// Conectar un canal nuevo no puede apagar otro que ya estaba pagado y andando.
export type AccountSlotResult = { ok: true } | { ok: false; message: string }

export function checkAccountSlotAvailable(
  input: {
    // Cuentas `active` del tenant que ocupan cupo (`countActivePages`).
    activePageCount: number
    maxPages: number
    // `true` cuando la cuenta que se está conectando **ya está activa** para
    // este mismo tenant. Reconectarla no pide un hueco nuevo: ya ocupa el suyo,
    // y contarlo dos veces dejaría a quien está al límite sin poder renovar el
    // token de una cuenta que ya tiene.
    reconnectingActiveAccount: boolean
  },
  t: AppDict
): AccountSlotResult {
  if (input.reconnectingActiveAccount) return { ok: true }
  if (input.activePageCount < input.maxPages) return { ok: true }

  return {
    ok: false,
    // El cupo se dice en **conexiones** (ADR 0011), igual que en el resto de
    // las pantallas: cuenta páginas de Facebook, cuentas de Instagram y números
    // de WhatsApp juntos, y decir «ya tienes 2 números» a quien tiene dos
    // páginas lo manda a buscar números que no existen. Y nombra la acción, no
    // la pantalla: liberar un hueco es lo único que desbloquea esto.
    message: fmt(t.actions.accountSlotFull, {
      maxPages: input.maxPages,
      activePageCount: input.activePageCount,
    }),
  }
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
export function validatePageSelection(
  input: {
    view: PageSelectionView
    selectedPageIds: string[]
  },
  t: AppDict
): PageSelectionResult {
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
        message: t.actions.invalidSelection,
      }
    }

    if (page.state === "already_connected") continue
    newPages.push({ pageId: page.metaPageId, name: page.name })
  }

  if (newPages.length > input.view.remainingSlots) {
    const { maxPages, activePageCount, remainingSlots } = input.view
    // El cupo se dice en **conexiones** (ADR 0011): cuenta todas, y las
    // `activePageCount` de este tenant pueden incluir cuentas de Instagram que
    // esta pantalla ni siquiera lista. Lo que se añade acá sí son páginas, y
    // por eso el resto de la frase las sigue nombrando así.
    const plan = fmt(t.actions.pageLimitPlan, { maxPages, activePageCount })
    const tail =
      remainingSlots === 0
        ? t.actions.pageLimitNone
        : fmt(
            remainingSlots === 1
              ? t.actions.pageLimitRemainingOne
              : t.actions.pageLimitRemainingMany,
            { remainingSlots }
          )

    return {
      ok: false,
      code: "page_limit_exceeded",
      message: `${plan}${tail}`,
    }
  }

  return { ok: true, value: newPages }
}
