import type { ConnectionStatus } from "@/lib/pages/channel-display"
import type {
  HistorySyncStatus,
  WhatsappOnboardingMode,
} from "@/lib/pages/connection-display"
import type { ChannelMap, HistorySyncCopy } from "./shared"

export type ChannelsDict = {
  label: ChannelMap
  /** «esta página» / «esta cuenta» / «este número». */
  noun: ChannelMap
  tokenInvalidBody: ChannelMap
  onboardingMode: Record<WhatsappOnboardingMode, string>
  historySync: Record<HistorySyncStatus, HistorySyncCopy>
  coexistenceLimits: readonly string[]
  statusBadge: Record<ConnectionStatus, string>
}

export const es: ChannelsDict = {
  label: {
    messenger: "Messenger",
    instagram: "Instagram",
    whatsapp: "WhatsApp",
  },
  noun: {
    messenger: "esta página",
    instagram: "esta cuenta",
    whatsapp: "este número",
  },
  tokenInvalidBody: {
    messenger:
      "Meta rechazó el token de la página. Reconéctala desde Facebook para renovar permisos antes de volver a enviar respuestas.",
    instagram:
      "Meta rechazó el token de la cuenta. Vuelve a autorizarla en Instagram para renovarlo antes de seguir enviando respuestas.",
    whatsapp:
      "Meta rechazó el token del número. Vuelve a lanzar el Embedded Signup para renovarlo: mientras tanto no entra ni sale nada por este número.",
  },
  onboardingMode: {
    standard: "número nuevo (estándar)",
    coexistence: "número existente (Coexistence)",
  },
  historySync: {
    not_requested: {
      label: "historial: sin pedir",
      body: "Todavía no pedimos el historial a Meta. El plazo de 24 horas desde la conexión ya corre: si se agota sin sincronizar, hay que rehacer la conexión.",
      actionLabel: null,
    },
    requested: {
      label: "historial: pedido",
      body: "Le pedimos el historial a Meta y estamos esperando el primer bloque. No hace falta que hagas nada.",
      actionLabel: null,
    },
    in_progress: {
      label: "historial: importando",
      body: "El historial está llegando por bloques. Las conversaciones aparecen en el Inbox a medida que se importan.",
      actionLabel: null,
    },
    complete: {
      label: "historial: completo",
      body: "El import terminó. Si el negocio eligió no compartir su historial, es normal que no haya aparecido ninguna conversación vieja.",
      actionLabel: null,
    },
    failed: {
      label: "historial: falló",
      body: "No pudimos importar el historial: agotamos los reintentos contra Meta. Vuelve a lanzar el alta de Coexistence para pedirlo otra vez, mientras el plazo de 24 horas siga abierto.",
      actionLabel: "Rehacer el alta de Coexistence",
    },
    expired: {
      label: "historial: vencido",
      body: "Pasó el plazo de 24 horas y la conexión hay que rehacerla desde el Embedded Signup. Meta da de baja el onboarding cuando el historial no se sincroniza dentro de esa ventana, y no existe forma de reanudarlo.",
      actionLabel: "Rehacer desde el Embedded Signup",
    },
  },
  coexistenceLimits: [
    "Techo fijo de 20 mensajes por segundo: un número en Coexistence no escala por messaging tier, por más volumen que tenga la cuenta.",
    "La elegibilidad la decide Meta: el país, el número, la cuenta, la versión de WhatsApp Business App o el dispositivo pueden dejarlo fuera, y no hay lista publicada.",
  ],
  statusBadge: {
    active: "activa",
    "no-access": "sin acceso",
    disconnected: "desconectada",
  },
}

export const en: ChannelsDict = {
  label: {
    messenger: "Messenger",
    instagram: "Instagram",
    whatsapp: "WhatsApp",
  },
  noun: {
    messenger: "this page",
    instagram: "this account",
    whatsapp: "this number",
  },
  tokenInvalidBody: {
    messenger:
      "Meta rejected this page's token. Reconnect it from Facebook to renew permissions before sending replies again.",
    instagram:
      "Meta rejected this account's token. Authorize it again on Instagram to renew it before sending more replies.",
    whatsapp:
      "Meta rejected this number's token. Run the Embedded Signup again to renew it: until then, nothing comes in or goes out through this number.",
  },
  onboardingMode: {
    standard: "new number (standard)",
    coexistence: "existing number (Coexistence)",
  },
  historySync: {
    not_requested: {
      label: "history: not requested",
      body: "We haven't requested the history from Meta yet. The 24-hour window since the connection is already running: if it runs out without syncing, the connection has to be redone.",
      actionLabel: null,
    },
    requested: {
      label: "history: requested",
      body: "We asked Meta for the history and we're waiting for the first batch. There's nothing you need to do.",
      actionLabel: null,
    },
    in_progress: {
      label: "history: importing",
      body: "The history is arriving in batches. Conversations show up in the Inbox as they're imported.",
      actionLabel: null,
    },
    complete: {
      label: "history: complete",
      body: "The import finished. If the business chose not to share its history, it's normal that no old conversations showed up.",
      actionLabel: null,
    },
    failed: {
      label: "history: failed",
      body: "We couldn't import the history: we ran out of retries against Meta. Run the Coexistence signup again to request it once more, while the 24-hour window is still open.",
      actionLabel: "Redo the Coexistence signup",
    },
    expired: {
      label: "history: expired",
      body: "The 24-hour window has passed and the connection has to be redone from the Embedded Signup. Meta cancels the onboarding when the history doesn't sync within that window, and there's no way to resume it.",
      actionLabel: "Redo from the Embedded Signup",
    },
  },
  coexistenceLimits: [
    "A hard ceiling of 20 messages per second: a Coexistence number doesn't scale by messaging tier, no matter how much volume the account has.",
    "Eligibility is Meta's call: the country, the number, the account, the WhatsApp Business App version or the device can rule it out, and there's no published list.",
  ],
  statusBadge: {
    active: "active",
    "no-access": "no access",
    disconnected: "disconnected",
  },
}
