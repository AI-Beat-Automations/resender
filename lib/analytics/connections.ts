import { countTenantConnections } from "@/lib/pages/page-registry"
import type { PageChannel } from "@/lib/pages/page-registry"

// Lo que comparten `page connected`, `instagram account connected`,
// `whatsapp number connected` y `page disconnected`. Todos van con el tenant
// como `distinct_id` —el [Padre], que es quien paga— y el [Cliente] en
// `client_id`, para que `connections_count` sea una sola cifra por cuenta.

// Antes de conectar: si el tenant nunca tuvo una conexión, la que viene es la
// primera. Best-effort: un fallo de la consulta no puede frenar una conexión.
export async function hadAnyConnection(tenantId: string): Promise<boolean> {
  try {
    return (await countTenantConnections(tenantId)).total > 0
  } catch {
    return true
  }
}

// Después de conectar o desconectar: las conexiones activas para el `$set`.
// `null` si la consulta falló, y entonces no se pisa la propiedad.
export async function activeConnectionsCount(
  tenantId: string
): Promise<number | null> {
  try {
    return (await countTenantConnections(tenantId)).active
  } catch {
    return null
  }
}

export function connectionEventProperties(input: {
  channel: PageChannel
  connectionId: string
  clientId: string | null
  isFirstConnection?: boolean
  connectionsCount: number | null
}) {
  return {
    channel: input.channel,
    connection_id: input.connectionId,
    client_id: input.clientId,
    ...(input.isFirstConnection === undefined
      ? {}
      : { is_first_connection: input.isFirstConnection }),
    ...(input.connectionsCount === null
      ? {}
      : { $set: { connections_count: input.connectionsCount } }),
  }
}
