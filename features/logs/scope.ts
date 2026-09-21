import {
  listClientNamesCached,
  resolveActorCached,
} from "@/features/clients/queries"
import { listTenantPagesCached } from "@/features/connections/queries"
import { getSession } from "@/lib/auth/session"
import { isClientActor } from "@/lib/clients/actor"
import {
  CLIENT_FILTER_PARAM,
  matchesClientFilter,
  resolveClientFilter,
  type ClientFilter,
  type ClientName,
} from "@/lib/clients/client-filter"
import {
  parseLogFilters,
  type LogFilters,
  type LogSearchParams,
} from "@/lib/logs/log-filters"
import { formatAccountShortLabel } from "@/lib/messages/display"

export type LogsAccountOption = { id: string; label: string }

export type LogsScope = {
  tenantId: string
  filters: LogFilters
  clientFilter: ClientFilter
  clients: ClientName[]
  /** Conexiones que el filtro puede elegir, ya acotadas por el cliente elegido. */
  accounts: LogsAccountOption[]
}

/**
 * Quién mira y con qué filtros, ya validados. Lo comparten la página y las
 * server actions para que el polling y el scroll apliquen exactamente los
 * mismos filtros que el primer render: la URL llega cruda y acá se vuelve a
 * pasar por los catálogos, nunca se confía en lo que mandó el navegador.
 *
 * Logs es **solo del padre**: un cliente devuelve `null` —la página lo manda a
 * Conexiones y las actions no contestan nada—.
 */
export async function resolveLogsScope(
  params: LogSearchParams
): Promise<LogsScope | null> {
  const session = await getSession()
  if (!session?.user?.id) return null
  const resolution = await resolveActorCached(session.user.id)
  if (resolution.kind !== "actor" || isClientActor(resolution.actor)) {
    return null
  }
  const { actor } = resolution
  const { tenantId } = actor

  const [clients, pages] = await Promise.all([
    listClientNamesCached(tenantId),
    listTenantPagesCached(tenantId, null),
  ])
  const clientFilter = resolveClientFilter(
    params[CLIENT_FILTER_PARAM],
    clients,
    actor
  )
  // Elegir un cliente acota el desplegable de conexiones a las suyas; una
  // `?cuenta=` de otro cliente deja de validar y se suelta sola.
  const accounts = pages
    .filter((page) => matchesClientFilter(clientFilter, page.clientAccountId))
    .map((page) => ({ id: page.id, label: formatAccountShortLabel(page) }))

  return {
    tenantId,
    filters: parseLogFilters(
      params,
      accounts.map((account) => account.id)
    ),
    clientFilter,
    clients: [...clients],
    accounts,
  }
}
