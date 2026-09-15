// Pausa de reenvío (ADR 0020). Módulo puro: decide si un entrante que ya se
// persistió y se contabilizó debe **dejar de reenviarse** al webhook del
// tenant, y por qué.
//
// Dos niveles, dos columnas `paused_at` (migración 0025):
//
// - **Conexión.** Llave maestra: pausada, no sale nada de esa conexión —ni DMs
//   ni comentarios—, sin importar el estado de cada conversación.
// - **Conversación.** Solo esa conversación. Se lee como «pausar a este
//   contacto»: en Instagram también corta sus comentarios, porque
//   `instagram_comments.from_ig_id` es la misma identidad que
//   `conversations.contact_id` (migración 0013).
//
// Los niveles son independientes: reanudar la conexión **no** reanuda las
// conversaciones que se pausaron una a una. Reenviar = conexión activa Y
// conversación activa.
//
// Es un `skipped` y no un `dropped` (`LogOutcome`): el entrante se guarda, se
// ve en Inbox y cuenta para la cuota, igual que con la [Cuenta restringida]
// (ADR 0003) o sin `webhookUrl`. Lo único que no pasa es el POST. Los eventos
// que llegan durante la pausa no se encolan para después: se descartan del
// reenvío y punto.

export type ForwardingPauseReason = "connection_paused" | "conversation_paused"

export type ForwardingPauseInput = {
  /** `connected_pages.paused_at`. */
  connectionPausedAt: Date | null
  /**
   * `conversations.paused_at`. Null cuando no está pausada **o cuando no hay
   * conversación** (un comentario de alguien que nunca escribió por DM).
   */
  conversationPausedAt: Date | null
}

/**
 * Por qué no se reenvía, o `null` si sí se reenvía. La conexión gana: si las
 * dos están pausadas, el motivo es el de la conexión, que es el que hay que
 * levantar primero para que el reenvío vuelva.
 */
export function resolveForwardingPause(
  input: ForwardingPauseInput
): ForwardingPauseReason | null {
  if (input.connectionPausedAt) return "connection_paused"
  if (input.conversationPausedAt) return "conversation_paused"
  return null
}

/** `true` si está pausada. `paused_at` con fecha es «pausada desde». */
export function isForwardingPaused(pausedAt: Date | null | undefined) {
  return pausedAt != null
}

// El texto que va a la columna `error` de `external_webhook_deliveries`,
// legible por humanos, como el de la cuenta restringida.
export const FORWARDING_PAUSE_SKIP_REASON: Record<
  ForwardingPauseReason,
  string
> = {
  connection_paused: "forwarding paused for the connection",
  conversation_paused: "forwarding paused for the conversation",
}
