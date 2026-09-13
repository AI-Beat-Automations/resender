import { cache } from "react"

import { resolveChannelAccess } from "@/lib/auth/channel-access"
import { listAgencyClients } from "@/lib/clients/client-repository"
import type { ConnectionScope } from "@/lib/pages/connection-scope"
import { listTenantPages } from "@/lib/pages/page-registry"

// Las mismas lecturas las hacen el header (slot `@header`) y la página de
// Conexiones en la misma petición. `cache` las deduplica por argumentos dentro
// del render, sin tocar `lib/`.
//
// El alcance se pasa desarmado en primitivos: `cache` compara argumentos por
// identidad, y dos objetos `scope` iguales construidos en el header y en la
// página serían dos lecturas.
const listPagesInScope = cache((tenantId: string, clientId: string | null) =>
  listTenantPages(
    clientId === null
      ? { tenantId, owner: true, clientId: null }
      : { tenantId, owner: false, clientId }
  )
)

export function listTenantPagesCached(scope: ConnectionScope) {
  return listPagesInScope(scope.tenantId, scope.clientId)
}

export const resolveChannelAccessCached = cache(resolveChannelAccess)
export const listAgencyClientsCached = cache(listAgencyClients)
