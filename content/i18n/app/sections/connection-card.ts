export type ConnectionCardDict = {
  /** `{date}` */
  connectedOn: string
  reconnect: string
  reconnectAgain: string
  disconnect: string
  tokenInvalidBadge: string
  /** Píldora junto al estado cuando el reenvío está pausado (ADR 0020). */
  pausedBadge: string
  /** Interruptor de pausa de reenvío: encabezado, aria y los dos estados. */
  forwardingLabel: string
  forwardingAria: string
  forwardingActive: string
  /** `{since}`: «hace 2 horas», ya en el idioma. */
  forwardingPaused: string
  forwardingPausedNow: string
  forwardingHint: string
  /** `{channel}` */
  noAccessTitle: string
  noAccessBody: string
  /** `{noun}` */
  tokenInvalidTitle: string
  /** `{date}` */
  tokenErrorDetectedOn: string
  whatsappOnboardingLabel: string
  whatsappOnboardingUnknown: string
  whatsappTokenLabel: string
  whatsappTokenValid: string
  whatsappTokenRejected: string
  whatsappSubscriptionLabel: string
  whatsappSubscriptionUnknown: string
  coexistenceLimitsTitle: string
  pinTitle: string
  pinBody: string
  pinReveal: string
  pinRevealing: string
  pinHide: string
  pinError: string
  webhookLabel: string
  webhookPlaceholder: string
  webhookHint: string
  signingSecretLabel: string
  rotate: string
  rotating: string
  generate: string
  secretRevealTitle: string
  secretWithBody: string
  secretWithoutBody: string
  /** Valor del campo del secreto cuando todavía no hay uno. */
  secretMissingValue: string
  /** `{date}` */
  disconnectedOn: string
  disconnectedNoDate: string
  disconnectedHistoryKept: string
  /** `{name}` */
  disconnectTitle: string
  disconnectBody: string
  disconnectConfirm: string
  disconnecting: string
}

export const es: ConnectionCardDict = {
  connectedOn: "conectada el",
  reconnect: "Reconectar",
  reconnectAgain: "Volver a conectar",
  disconnect: "Desconectar",
  tokenInvalidBadge: "token inválido",
  pausedBadge: "automatización pausada",
  forwardingLabel: "Automatización",
  forwardingAria: "Pausar o reanudar la automatización",
  forwardingActive: "Activa",
  forwardingPaused: "Pausada desde {since}",
  forwardingPausedNow: "Pausada",
  forwardingHint:
    "Mientras esté pausada, los mensajes y comentarios se guardan en Inbox pero no llegan a tu automatización. Al reanudar no se envía lo que llegó durante la pausa.",
  noAccessTitle: "El canal de {channel} no está habilitado para tu cuenta.",
  noAccessBody:
    "La conexión sigue en pie y su historial disponible, pero no recibe mensajes nuevos y no puede responder. Escríbenos a info@resender.dev para habilitarlo.",
  tokenInvalidTitle: "Hay que reconectar {noun}.",
  tokenErrorDetectedOn: "detectado el {date}",
  whatsappOnboardingLabel: "alta:",
  whatsappOnboardingUnknown: "sin registrar",
  whatsappTokenLabel: "token:",
  whatsappTokenValid: "válido",
  whatsappTokenRejected: "rechazado por Meta",
  whatsappSubscriptionLabel: "suscripción:",
  whatsappSubscriptionUnknown: "sin datos",
  coexistenceLimitsTitle: "Límites de Coexistence",
  pinTitle: "Verificación en dos pasos",
  pinBody:
    "Al registrar este número le activamos la verificación en dos pasos con un PIN que generamos nosotros. Meta no vuelve a mostrarlo: necesitas este PIN para volver a registrar el número, aquí o en cualquier otra plataforma.",
  pinReveal: "Ver PIN",
  pinRevealing: "Recuperando…",
  pinHide: "Ocultar",
  pinError: "No pudimos recuperar el PIN ahora mismo. Vuelve a intentarlo.",
  webhookLabel: "Webhook URL",
  webhookPlaceholder: "https://tu-automatizacion.example/webhook",
  webhookHint: "Cada mensaje entrante se reenvía con un POST a esta URL.",
  signingSecretLabel: "Secreto de firma",
  rotate: "Rotar",
  rotating: "Rotando…",
  generate: "Generar",
  secretRevealTitle: "Cópialo ahora: no vuelve a mostrarse.",
  secretWithBody:
    "Cada POST lleva las cabeceras resender-signature, resender-event-id y resender-timestamp. Rotar invalida el secreto anterior.",
  secretWithoutBody:
    "Todavía sin firma: el receptor no puede verificar que el POST venga de Resender.",
  secretMissingValue: "todavía sin secreto",
  disconnectedOn: "Desconectada el {date}. ",
  disconnectedNoDate: "Desconectada. ",
  disconnectedHistoryKept:
    "El historial sigue disponible en el log de mensajes.",
  disconnectTitle: "¿Desconectar {name}?",
  disconnectBody:
    "Dejará de recibir tráfico nuevo, pero el historial se conserva. Puedes volver a conectarla más adelante.",
  disconnectConfirm: "Sí, desconectar",
  disconnecting: "Desconectando…",
}

export const en: ConnectionCardDict = {
  connectedOn: "connected on",
  reconnect: "Reconnect",
  reconnectAgain: "Connect again",
  disconnect: "Disconnect",
  tokenInvalidBadge: "invalid token",
  pausedBadge: "automation paused",
  forwardingLabel: "Automation",
  forwardingAria: "Pause or resume automation",
  forwardingActive: "On",
  forwardingPaused: "Paused since {since}",
  forwardingPausedNow: "Paused",
  forwardingHint:
    "While paused, messages and comments are saved in Inbox but don't reach your automation. Resuming doesn't send what arrived during the pause.",
  noAccessTitle: "The {channel} channel isn't enabled for your account.",
  noAccessBody:
    "The connection is still in place and its history is available, but it doesn't receive new messages and can't reply. Write to info@resender.dev to have it enabled.",
  tokenInvalidTitle: "You need to reconnect {noun}.",
  tokenErrorDetectedOn: "detected on {date}",
  whatsappOnboardingLabel: "signup:",
  whatsappOnboardingUnknown: "not registered",
  whatsappTokenLabel: "token:",
  whatsappTokenValid: "valid",
  whatsappTokenRejected: "rejected by Meta",
  whatsappSubscriptionLabel: "subscription:",
  whatsappSubscriptionUnknown: "no data",
  coexistenceLimitsTitle: "Coexistence limits",
  pinTitle: "Two-step verification",
  pinBody:
    "When we registered this number we turned on two-step verification with a PIN we generated. Meta never shows it again: you need this PIN to register the number again, here or on any other platform.",
  pinReveal: "Show PIN",
  pinRevealing: "Retrieving…",
  pinHide: "Hide",
  pinError: "We couldn't retrieve the PIN right now. Please try again.",
  webhookLabel: "Webhook URL",
  webhookPlaceholder: "https://your-automation.example/webhook",
  webhookHint: "Every incoming message is forwarded as a POST to this URL.",
  signingSecretLabel: "Signing secret",
  rotate: "Rotate",
  rotating: "Rotating…",
  generate: "Generate",
  secretRevealTitle: "Copy it now: it won't be shown again.",
  secretWithBody:
    "Every POST carries the resender-signature, resender-event-id and resender-timestamp headers. Rotating invalidates the previous secret.",
  secretWithoutBody:
    "No signature yet: the receiver can't verify that the POST comes from Resender.",
  secretMissingValue: "no secret yet",
  disconnectedOn: "Disconnected on {date}. ",
  disconnectedNoDate: "Disconnected. ",
  disconnectedHistoryKept: "The history is still available in the message log.",
  disconnectTitle: "Disconnect {name}?",
  disconnectBody:
    "It will stop receiving new traffic, but the history is kept. You can connect it again later.",
  disconnectConfirm: "Yes, disconnect",
  disconnecting: "Disconnecting…",
}
