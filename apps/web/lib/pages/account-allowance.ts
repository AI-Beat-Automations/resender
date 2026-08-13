import type { PageStatus } from "./page-registry"

// Módulo puro del cupo para conexiones de una cuenta por vez (ADR 0010).
//
// Es el gemelo de `page-selection.ts`, no un reemplazo: aquel modela «la lista
// que devolvió Meta» y decide página por página, porque Facebook devuelve todas
// las Páginas que el usuario administra. Instagram Login devuelve exactamente
// una cuenta, así que acá no hay lista que clasificar — hay una sola pregunta,
// «¿entra?», y la respuesta depende de si esta cuenta ya ocupaba un slot.

export type AccountSlotDecision =
  | { ok: true; reason: "reauthorization" | "new_slot" }
  | { ok: false; code: "account_limit_reached"; message: string }

export function evaluateAccountSlot(input: {
  maxAccounts: number
  activeAccountCount: number
  // Estado de la fila `(channel, meta_page_id)` **de este tenant**, o null si no
  // existe. Una fila de otro tenant no llega acá: ese caso no es de cupo sino de
  // propiedad, y lo resuelve `PageOwnershipError` con su propio mensaje.
  existingStatus: PageStatus | null
}): AccountSlotDecision {
  // Re-autorizar una cuenta que ya está activa no consume un slot nuevo: la
  // cuenta ya estaba contada. En Instagram esto es rutina, no excepción — el
  // token vence a los ~60 días y reconectar es el mantenimiento normal. Cobrarle
  // un slot dejaría varado sin salida a quien esté justo en el tope: no podría
  // renovar el token de una cuenta que ya tiene.
  if (input.existingStatus === "active") {
    return { ok: true, reason: "reauthorization" }
  }

  // Lo demás —cuenta nueva, o una `disconnected` que vuelve— consume slot.
  // Reconectar cuesta cupo igual que en Facebook (`page-selection.ts`).
  if (input.activeAccountCount < input.maxAccounts) {
    return { ok: true, reason: "new_slot" }
  }

  return {
    ok: false,
    code: "account_limit_reached",
    message: `Tu plan permite ${input.maxAccounts} cuentas conectadas y ya tienes ${input.activeAccountCount} activas: no te queda cupo. Desconecta una cuenta para liberar cupo y conectar otra.`,
  }
}
