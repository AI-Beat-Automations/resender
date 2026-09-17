import { CLIENT_FILTER_PARAM } from "@/lib/clients/client-filter"

// Único constructor de enlaces de Conexiones con el filtro por cliente
// (issue #154, ticket 4). Gemelo de `inboxHref`: el estado vive en la URL
// (ADR 0005), y `/connections` a secas sigue siendo la URL canónica.
// Módulo puro: sin React, sin Next, sin DB.
export function connectionsHref(input: { clientFilter?: string | null }) {
  const params = new URLSearchParams()
  if (input.clientFilter) params.set(CLIENT_FILTER_PARAM, input.clientFilter)
  const query = params.toString()
  return query ? `/connections?${query}` : "/connections"
}
