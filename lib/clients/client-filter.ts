// Filtro por cliente de Conexiones e Inbox (issue #154, ticket 4). Es un
// filtro de **vista** del padre, distinto del alcance de seguridad del actor:
// el alcance (`clientAccountId` del [Actor]) decide qué filas existen para la
// sesión y no se mueve por URL; el filtro decide cuáles de esas filas se
// muestran y vive en `?cliente=` (ADR 0005: el estado de la pantalla va en la
// URL, no en React). Un cliente no filtra: ya ve solo lo suyo.
// Módulo puro: sin React, sin Next, sin DB.

/** Nombre del `searchParam`. En español como las rutas del módulo. */
export const CLIENT_FILTER_PARAM = "cliente"

/** Valor de `?cliente=` que deja solo las conexiones propias del padre. */
export const OWN_CLIENT_FILTER = "propias"

export type ClientFilter =
  /** Sin filtro: todo lo que el actor puede ver. */
  | { kind: "all" }
  /** Solo las filas sin cliente: las del padre. */
  | { kind: "own" }
  /** Solo las filas de este cliente. */
  | { kind: "client"; clientAccountId: string }

export const ALL_CLIENTS_FILTER: ClientFilter = { kind: "all" }

export type ClientName = { id: string; name: string }

/**
 * Resuelve `?cliente=` contra la lista de clientes del tenant. Un id que no
 * está en la lista se descarta en silencio, igual que `?page=` en Inbox: es
 * entrada del usuario, no un contrato. Para un actor cliente devuelve siempre
 * «todo»: no tiene a quién filtrar y así el parámetro no puede ampliar nada.
 */
export function resolveClientFilter(
  param: string | string[] | undefined,
  clients: readonly ClientName[],
  actor: { clientAccountId: string | null }
): ClientFilter {
  if (actor.clientAccountId !== null) return ALL_CLIENTS_FILTER
  const value = Array.isArray(param) ? param[0] : param
  if (!value) return ALL_CLIENTS_FILTER
  if (value === OWN_CLIENT_FILTER) return { kind: "own" }
  return clients.some((client) => client.id === value)
    ? { kind: "client", clientAccountId: value }
    : ALL_CLIENTS_FILTER
}

/** El valor que va en la URL, o null si no hay filtro. Inverso de `resolve`. */
export function clientFilterParam(filter: ClientFilter): string | null {
  switch (filter.kind) {
    case "all":
      return null
    case "own":
      return OWN_CLIENT_FILTER
    case "client":
      return filter.clientAccountId
  }
}

/** Si una fila con ese `client_account_id` pasa el filtro. Para listas ya
 * cargadas (opciones de un desplegable); las consultas aplican el mismo
 * criterio en SQL. */
export function matchesClientFilter(
  filter: ClientFilter,
  clientAccountId: string | null
): boolean {
  switch (filter.kind) {
    case "all":
      return true
    case "own":
      return clientAccountId === null
    case "client":
      return clientAccountId === filter.clientAccountId
  }
}

/**
 * Lo que las consultas necesitan del filtro, en dos parámetros planos para el
 * SQL: `own` deja solo `client_account_id is null`; `clientAccountId` deja solo
 * ese cliente; los dos apagados es «todo». Predicado:
 * `(not ${own} or client_account_id is null)
 *  and (${id}::uuid is null or client_account_id = ${id}::uuid)`.
 */
export function clientFilterPredicate(filter: ClientFilter | undefined): {
  own: boolean
  clientAccountId: string | null
} {
  if (!filter || filter.kind === "all") return { own: false, clientAccountId: null }
  if (filter.kind === "own") return { own: true, clientAccountId: null }
  return { own: false, clientAccountId: filter.clientAccountId }
}
