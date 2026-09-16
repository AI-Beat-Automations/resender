import type { PlanLookupKey } from "@/lib/billing/plans"

// Reglas puras del módulo Clientes (issue #154). Sin base, sin sesión, sin
// idioma: las acciones de `features/clients` las llaman y traducen el código.
// La regla de cupo al conectar (`client-limits`) llega en el ticket 3; acá
// vive solo lo que el padre necesita para crear y administrar clientes.

// Solo Pro y Business invitan. Starter y Free no ven el módulo operable.
const PLANS_WITH_CLIENTS: readonly PlanLookupKey[] = [
  "pro_monthly",
  "business_monthly",
]

export function canManageClients(
  priceLookupKey: string | null | undefined
): boolean {
  return (PLANS_WITH_CLIENTS as readonly string[]).includes(
    priceLookupKey ?? ""
  )
}

export type MaxConnectionsResult =
  { ok: true; value: number } | { ok: false; error: "max_out_of_range" }

// `1 ≤ tope ≤ maxPages del plan del padre` (ADR 0011: `maxPages` sigue
// significando «máximo de conexiones»). El tope es un máximo, no una reserva:
// se acepta uno menor a lo que el cliente ya tiene conectado, y la lista lo
// pinta en rojo en vez de obligar a desconectar en nombre del cliente.
export function validateMaxConnections(
  input: unknown,
  planMaxPages: number
): MaxConnectionsResult {
  const raw = typeof input === "number" ? input : Number(input)
  if (
    typeof input === "boolean" ||
    input === null ||
    input === undefined ||
    input === "" ||
    !Number.isInteger(raw)
  ) {
    return { ok: false, error: "max_out_of_range" }
  }
  if (raw < 1 || raw > planMaxPages) {
    return { ok: false, error: "max_out_of_range" }
  }
  return { ok: true, value: raw }
}

export function isOverMax(connected: number, max: number): boolean {
  return connected > max
}
