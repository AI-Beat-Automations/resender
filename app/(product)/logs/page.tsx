import { redirect } from "next/navigation"

import { resolveLogsScope } from "@/features/logs/scope"
import { LogsView } from "@/features/logs/ui/logs-view"
import {
  logsHref,
  parseSelectedLog,
  type LogSearchParams,
} from "@/lib/logs/log-filters"
import {
  countRequestLogFacets,
  getRequestLog,
  listRequestLogs,
} from "@/lib/logs/read-model"

// `/logs`: la bitácora de peticiones del padre —lo que llega de Meta, lo que
// se reenvía a su bot y lo que su bot le pide a la API—. A sangre completa
// bajo el header, como Inbox: panel de filtros, tabla y sheet de detalle.
//
// El servidor pinta la primera página con los filtros de la URL; el scroll, el
// polling y el detalle los pide después el cliente por server actions.
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<LogSearchParams>
}) {
  const params = await searchParams
  const scope = await resolveLogsScope(params)
  // Un cliente no ve Logs: el sidebar no se lo dibuja y por URL vuelve a
  // Conexiones, igual que `/clientes`. Sin sesión, el layout ya rebotó.
  if (!scope) redirect("/connections")

  const selectedId = parseSelectedLog(params)
  const [page, facets, selected] = await Promise.all([
    listRequestLogs(scope),
    countRequestLogFacets(scope),
    selectedId ? getRequestLog(scope.tenantId, selectedId) : null,
  ])

  return (
    <LogsView
      // Cambiar un filtro es otra lista: se remonta en vez de mezclar filas
      // de dos consultas distintas.
      key={logsHref(scope.filters, scope.clientFilter)}
      filters={scope.filters}
      clientFilter={scope.clientFilter}
      clients={scope.clients}
      accounts={scope.accounts}
      initialPage={page}
      initialFacets={facets}
      initialSelected={selected}
    />
  )
}
