import type {
  RequestLogDirection,
  RequestLogStatus,
} from "@/lib/logs/request-log"
import type { LogHttpClass, LogPeriod } from "@/lib/logs/log-filters"

// La sección Logs (`/logs`): la bitácora de peticiones del padre. No confundir
// con `log.ts`, que es el renglón de mensajes del Inbox.
export type RequestLogsDict = {
  title: string
  clear: string
  live: string
  livePaused: string
  refresh: string
  searchPlaceholder: string
  filters: {
    period: string
    status: string
    direction: string
    platform: string
    client: string
    account: string
    http: string
    allAccounts: string
    anyHttp: string
  }
  periods: Record<LogPeriod, string>
  statuses: Record<RequestLogStatus, string>
  directions: Record<RequestLogDirection, string>
  httpClasses: Record<LogHttpClass, string>
  columns: {
    date: string
    status: string
    direction: string
    endpoint: string
    account: string
    channel: string
    http: string
    duration: string
  }
  /** `{days}` */
  loadingMore: string
  /** `{days}` */
  endOfList: string
  loadMore: string
  /** Aviso sobre la tabla cuando se listan los parientes de una fila. */
  relatedBanner: string
  relatedClear: string
  empty: { title: string; body: string }
  emptyFiltered: { title: string; body: string }
  detail: {
    title: string
    close: string
    loading: string
    notFound: string
    copy: string
    copied: string
    truncated: string
    noBody: string
    viewConversation: string
    viewRelated: string
    fields: {
      eventId: string
      requestId: string
      direction: string
      eventType: string
      endpoint: string
      account: string
      client: string
      contact: string
      providerId: string
      duration: string
      attempts: string
      signature: string
    }
    /** `{attempt}` `{max}` */
    attempts: string
    /** `{time}` */
    nextRetry: string
    nextRetrySoon: string
    signed: string
    unsigned: string
    requestLabel: Record<RequestLogDirection, string>
    responseLabel: Record<RequestLogDirection, string>
    /** Sin respuesta del bot: timeout o error de red. */
    noResponse: string
    eventTypes: Record<string, string>
    skipReasons: Record<string, string>
    skipFallback: string
  }
}

export const es: RequestLogsDict = {
  title: "Logs",
  clear: "Limpiar",
  live: "En vivo",
  livePaused: "En pausa",
  refresh: "Refrescar",
  searchPlaceholder: "Buscar por endpoint, event_id, PSID o mensaje de error…",
  filters: {
    period: "Período",
    status: "Estado",
    direction: "Dirección",
    platform: "Plataforma",
    client: "Cliente",
    account: "Conexión",
    http: "Código HTTP",
    allAccounts: "Todas las cuentas",
    anyHttp: "Cualquiera",
  },
  periods: {
    "1h": "Última hora",
    "24h": "Últimas 24 horas",
    "7d": "Últimos 7 días",
    "30d": "Últimos 30 días",
  },
  statuses: {
    success: "Success",
    failed: "Failed",
    retrying: "Retrying",
    skipped: "Skipped",
  },
  directions: {
    meta_to_resender: "Meta → Resender",
    resender_to_bot: "Resender → bot",
    bot_to_resender: "Bot → Resender",
  },
  httpClasses: { "2xx": "2xx · éxito", "4xx": "4xx · cliente", "5xx": "5xx · servidor" },
  columns: {
    date: "Fecha",
    status: "Estado",
    direction: "Dirección",
    endpoint: "Endpoint",
    account: "Cuenta",
    channel: "Canal",
    http: "HTTP",
    duration: "Duración",
  },
  loadingMore: "Cargando más registros al desplazarte · se conservan {days} días",
  endOfList: "No hay más registros · se conservan {days} días",
  loadMore: "Cargar más",
  relatedBanner: "Mostrando los registros relacionados con una petición.",
  relatedClear: "Ver todos",
  empty: {
    title: "Todavía no hay registros",
    body: "Acá vas a ver cada webhook que llega de Meta, cada reenvío a tu bot y cada llamada de tu bot a la API, en cuanto haya tráfico.",
  },
  emptyFiltered: {
    title: "Nada coincide con estos filtros",
    body: "Probá con un período más amplio o limpiá los filtros.",
  },
  detail: {
    title: "Detalle de la petición",
    close: "Cerrar",
    loading: "Cargando…",
    notFound: "Este registro ya no existe: puede haber cumplido su retención.",
    copy: "Copiar",
    copied: "Copiado",
    truncated: "recortado a 64 KB",
    noBody: "— vacío",
    viewConversation: "Ver conversación",
    viewRelated: "Ver relacionados",
    fields: {
      eventId: "event_id",
      requestId: "request_id",
      direction: "dirección",
      eventType: "evento",
      endpoint: "endpoint",
      account: "cuenta",
      client: "cliente",
      contact: "contacto",
      providerId: "id de Meta",
      duration: "duración",
      attempts: "intentos",
      signature: "firma",
    },
    attempts: "{attempt} de {max}",
    nextRetry: "próximo reintento en {time}",
    nextRetrySoon: "reintento en curso",
    signed: "resender-signature enviada",
    unsigned: "sin firma (conexión sin secreto)",
    requestLabel: {
      meta_to_resender: "payload recibido",
      resender_to_bot: "payload enviado",
      bot_to_resender: "request del bot",
    },
    responseLabel: {
      meta_to_resender: "resultado del procesamiento",
      resender_to_bot: "respuesta del bot",
      bot_to_resender: "respuesta de Resender",
    },
    noResponse: "— sin respuesta",
    eventTypes: {
      message: "mensaje",
      postback: "postback",
      echo: "eco de la Business App",
      status: "acuse de entrega",
      comment: "comentario",
      send: "envío de mensaje",
      comment_reply: "respuesta a comentario",
      private_reply: "respuesta privada",
    },
    skipReasons: {
      duplicate: "Meta reenvió un evento que ya habíamos procesado. No se hizo nada.",
      webhook_url_not_configured:
        "La conexión no tiene webhook configurado, así que el evento no se reenvió.",
      connection_paused:
        "El reenvío de esta conexión está pausado, así que el evento no se reenvió.",
      conversation_paused:
        "El reenvío de esta conversación está pausado, así que el evento no se reenvió.",
      account_restricted:
        "La cuenta está restringida (cuota agotada o conexiones de más), así que el evento no se reenvió.",
    },
    skipFallback: "El evento se omitió a propósito.",
  },
}

export const en: RequestLogsDict = {
  title: "Logs",
  clear: "Clear",
  live: "Live",
  livePaused: "Paused",
  refresh: "Refresh",
  searchPlaceholder: "Search by endpoint, event_id, PSID or error message…",
  filters: {
    period: "Period",
    status: "Status",
    direction: "Direction",
    platform: "Platform",
    client: "Client",
    account: "Connection",
    http: "HTTP code",
    allAccounts: "All accounts",
    anyHttp: "Any",
  },
  periods: {
    "1h": "Last hour",
    "24h": "Last 24 hours",
    "7d": "Last 7 days",
    "30d": "Last 30 days",
  },
  statuses: {
    success: "Success",
    failed: "Failed",
    retrying: "Retrying",
    skipped: "Skipped",
  },
  directions: {
    meta_to_resender: "Meta → Resender",
    resender_to_bot: "Resender → bot",
    bot_to_resender: "Bot → Resender",
  },
  httpClasses: { "2xx": "2xx · success", "4xx": "4xx · client", "5xx": "5xx · server" },
  columns: {
    date: "Date",
    status: "Status",
    direction: "Direction",
    endpoint: "Endpoint",
    account: "Account",
    channel: "Channel",
    http: "HTTP",
    duration: "Duration",
  },
  loadingMore: "Loading more records as you scroll · kept for {days} days",
  endOfList: "No more records · kept for {days} days",
  loadMore: "Load more",
  relatedBanner: "Showing the records related to one request.",
  relatedClear: "Show all",
  empty: {
    title: "No records yet",
    body: "Every webhook from Meta, every forward to your bot and every call your bot makes to the API will show up here as soon as there is traffic.",
  },
  emptyFiltered: {
    title: "Nothing matches these filters",
    body: "Try a wider period or clear the filters.",
  },
  detail: {
    title: "Request detail",
    close: "Close",
    loading: "Loading…",
    notFound: "This record no longer exists: it may have reached its retention.",
    copy: "Copy",
    copied: "Copied",
    truncated: "trimmed to 64 KB",
    noBody: "— empty",
    viewConversation: "View conversation",
    viewRelated: "View related",
    fields: {
      eventId: "event_id",
      requestId: "request_id",
      direction: "direction",
      eventType: "event",
      endpoint: "endpoint",
      account: "account",
      client: "client",
      contact: "contact",
      providerId: "Meta id",
      duration: "duration",
      attempts: "attempts",
      signature: "signature",
    },
    attempts: "{attempt} of {max}",
    nextRetry: "next retry in {time}",
    nextRetrySoon: "retry in progress",
    signed: "resender-signature sent",
    unsigned: "unsigned (connection has no secret)",
    requestLabel: {
      meta_to_resender: "received payload",
      resender_to_bot: "sent payload",
      bot_to_resender: "bot request",
    },
    responseLabel: {
      meta_to_resender: "processing result",
      resender_to_bot: "bot response",
      bot_to_resender: "Resender response",
    },
    noResponse: "— no response",
    eventTypes: {
      message: "message",
      postback: "postback",
      echo: "Business App echo",
      status: "delivery receipt",
      comment: "comment",
      send: "message send",
      comment_reply: "comment reply",
      private_reply: "private reply",
    },
    skipReasons: {
      duplicate: "Meta re-sent an event we had already processed. Nothing was done.",
      webhook_url_not_configured:
        "The connection has no webhook configured, so the event was not forwarded.",
      connection_paused:
        "Forwarding is paused for this connection, so the event was not forwarded.",
      conversation_paused:
        "Forwarding is paused for this conversation, so the event was not forwarded.",
      account_restricted:
        "The account is restricted (quota exhausted or too many connections), so the event was not forwarded.",
    },
    skipFallback: "The event was skipped on purpose.",
  },
}
