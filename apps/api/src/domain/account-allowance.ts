export type PageStatus = "active" | "disconnected"

// Gemelo de `apps/web/lib/pages/account-allowance.ts`. Ver ahí la justificación
// completa: es el cupo para las conexiones de una cuenta por vez (Instagram),
// donde no hay lista que clasificar como en la selección de Páginas.

export type AccountSlotDecision =
  | { ok: true; reason: "reauthorization" | "new_slot" }
  | { ok: false; code: "account_limit_reached" }

export function evaluateAccountSlot(input: {
  maxAccounts: number
  activeAccountCount: number
  // Estado de la fila de **este** tenant, o null si no existe. Una fila de otro
  // tenant no llega acá: ese caso es de propiedad, no de cupo.
  existingStatus: PageStatus | null
}): AccountSlotDecision {
  // Re-autorizar una cuenta ya activa no consume slot nuevo: ya estaba contada.
  // En Instagram el token vence a los ~60 días, así que reconectar es
  // mantenimiento rutinario; cobrarle un slot dejaría sin salida a quien esté
  // justo en el tope.
  if (input.existingStatus === "active") {
    return { ok: true, reason: "reauthorization" }
  }

  if (input.activeAccountCount < input.maxAccounts) {
    return { ok: true, reason: "new_slot" }
  }

  return { ok: false, code: "account_limit_reached" }
}
