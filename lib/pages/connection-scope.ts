import type { Actor } from "@/lib/auth/actor"

// Qué conexiones puede tocar quien opera (ADR 0020).
//
// El dueño ve todas las del tenant. La persona de un cliente de agencia ve solo
// las asignadas a su cliente: ni las de otro cliente ni las "sin asignar".
//
// En SQL el predicado es siempre el mismo y se escribe igual en todos lados:
//
//   and (${scope.owner} or p.agency_client_id = ${scope.clientId})
//
// Para un cliente `clientId` nunca es null por tipo; y aunque lo fuera,
// `= null` no matchea nada, así que el error cae del lado cerrado.

export type ConnectionScope =
  | { tenantId: string; owner: true; clientId: null }
  | { tenantId: string; owner: false; clientId: string }

export function scopeOf(actor: Actor): ConnectionScope {
  if (actor.kind === "owner") return ownerScope(actor.tenantId)
  return { tenantId: actor.tenantId, owner: false, clientId: actor.clientId }
}

/**
 * Alcance completo del tenant. Para quien no es una persona: la API externa
 * autenticada con API key —que es del dueño— y los procesos del sistema.
 */
export function ownerScope(tenantId: string): ConnectionScope {
  return { tenantId, owner: true, clientId: null }
}

/** Si una conexión ya persistida cae dentro del alcance. */
export function scopeOwnsRow(
  row: { tenantId: string; agencyClientId: string | null },
  scope: ConnectionScope
): boolean {
  if (row.tenantId !== scope.tenantId) return false
  if (scope.owner) return true
  return row.agencyClientId === scope.clientId
}
