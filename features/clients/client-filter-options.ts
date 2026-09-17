import type { AppDict } from "@/content/i18n/app"
import {
  OWN_CLIENT_FILTER,
  type ClientName,
} from "@/lib/clients/client-filter"

import type { ClientFilterOption } from "./ui/client-filter-combobox"

// Las opciones del filtro por cliente, con el href de cada una ya resuelto
// por la pantalla que lo monta (Conexiones e Inbox construyen enlaces
// distintos). Orden fijo: todos, las propias, y un cliente por fila.
export function clientFilterOptions(
  clients: readonly ClientName[],
  hrefFor: (clientFilter: string | null) => string,
  t: AppDict
): ClientFilterOption[] {
  return [
    { id: null, label: t.clients.filterAll, href: hrefFor(null) },
    {
      id: OWN_CLIENT_FILTER,
      label: t.clients.filterOwn,
      href: hrefFor(OWN_CLIENT_FILTER),
    },
    ...clients.map((client) => ({
      id: client.id,
      label: client.name,
      href: hrefFor(client.id),
    })),
  ]
}
