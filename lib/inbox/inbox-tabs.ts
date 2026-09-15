// El modo de Inbox vive en la URL, no en estado de React (ADR 0005): la
// pantalla tiene que ser recargable y compartible, y así sigue siendo server
// component entera. Mismo contrato que `lib/settings/settings-tabs.ts` —clave
// en inglés, valores en español—, más el constructor de enlaces.
// Módulo puro: sin React, sin Next, sin DB.

export type InboxTab = "mensajes" | "comentarios"

export const DEFAULT_INBOX_TAB: InboxTab = "mensajes"

// Orden de los dos modos; la UI lo lee de aquí en vez de redeclararlo. La
// **etiqueta** vive en `t.inbox.tabs`, que es un `Record<InboxTab, string>`: el
// id es contrato de URL —`?tab=comentarios` está en enlaces que la gente ya
// guardó— y por eso sigue en español aunque la etiqueta se traduzca.
export const INBOX_TABS: readonly InboxTab[] = ["mensajes", "comentarios"]

export function isInboxTab(value: unknown): value is InboxTab {
  return INBOX_TABS.some((tab) => tab === value)
}

// `searchParams` de Next puede entregar `string`, `string[]` (`?tab=a&tab=b`)
// o `undefined`. El parámetro es entrada del usuario, no un contrato: cualquier
// valor que no sea un modo conocido cae en el de por defecto.
export function resolveInboxTab(
  param: string | string[] | undefined
): InboxTab {
  const value = firstParam(param)
  return isInboxTab(value) ? value : DEFAULT_INBOX_TAB
}

/** Primer valor de un `searchParam`, para los que no son enum. */
export function firstParam(
  param: string | string[] | undefined
): string | undefined {
  return Array.isArray(param) ? param[0] : param
}

/**
 * Único constructor de enlaces de la pantalla. La selección se filtra POR MODO
 * acá dentro, así que ningún call site puede emitir `conversation` en
 * comentarios ni `media` en mensajes: un parámetro rancio es imposible por
 * construcción, no por limpieza posterior.
 *
 * `tab` se omite cuando es el de por defecto —a diferencia de Ajustes, que
 * siempre lo emite— para que `/inbox`, que es lo que enlaza el sidebar, sea la
 * URL canónica de la pantalla más visitada.
 */
export function inboxHref(input: {
  tab?: InboxTab
  pageId?: string | null
  conversationId?: string | null
  publicationKey?: string | null
}): string {
  const tab = input.tab ?? DEFAULT_INBOX_TAB
  const params = new URLSearchParams()

  if (tab !== DEFAULT_INBOX_TAB) params.set("tab", tab)
  if (input.pageId) params.set("page", input.pageId)
  if (tab === "mensajes" && input.conversationId) {
    params.set("conversation", input.conversationId)
  }
  if (tab === "comentarios" && input.publicationKey) {
    params.set("media", input.publicationKey)
  }

  const query = params.toString()
  return query ? `/inbox?${query}` : "/inbox"
}
