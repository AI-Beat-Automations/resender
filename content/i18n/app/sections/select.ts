export type SelectDict = {
  eyebrow: string
  title: string
  subtitle: string
  back: string
  noAuthTitle: string
  noAuthBody: string
  planUnresolvedTitle: string
  planUnresolvedBody: string
  planHeading: string
  /** Alrededor del rango en mono: `{before}{range}{after}`. */
  planUsageBefore: string
  /** `{activePageCount}`, `{maxPages}` */
  planUsageRange: string
  planUsageAfter: string
  /** `{activePageCount}`, `{maxPages}` */
  planUsage: string
  /** `{count}` */
  allowanceOne: string
  /** `{count}` */
  allowanceMany: string
  allowanceNone: string
  emptyTitle: string
  emptyBody: string
  listHeading: string
  badgeConnected: string
  badgeForeign: string
  foreignBody: string
  connectedBody: string
  addOnlyHint: string
  /** `{remainingSlots}`, `{maxPages}` */
  atLimitHint: string
  submit: string
  submitting: string
}

export const es: SelectDict = {
  eyebrow: "conexiones",
  title: "Elegir páginas",
  subtitle:
    "Elige cuáles de las páginas que administras en Facebook quieres conectar a Resender.",
  back: "Volver a Conexiones sin conectar nada",
  noAuthTitle: "Todavía no autorizaste tus páginas en Meta.",
  noAuthBody:
    "Necesitamos tu autorización para listar las páginas que administras. Conecta Facebook y vuelves acá a elegir cuáles conectar.",
  planUnresolvedTitle: "No pudimos resolver los límites de tu plan.",
  planUnresolvedBody:
    "Escríbenos a info@resender.dev para revisar tu suscripción antes de conectar páginas.",
  planHeading: "Tu plan",
  planUsageBefore: "Tienes ",
  planUsageRange: "{activePageCount} de {maxPages}",
  planUsageAfter: " conexiones.",
  planUsage: "Tienes {activePageCount} de {maxPages} conexiones.",
  allowanceOne: "Puedes añadir {count} página más.",
  allowanceMany: "Puedes añadir {count} páginas más.",
  allowanceNone:
    "No te queda cupo: desconecta una página para liberar cupo y conectar otra.",
  emptyTitle: "Todavía no hay páginas que puedas conectar.",
  emptyBody:
    "Meta no devolvió ninguna página que administres. Revisa que le hayas dado acceso a tus páginas y vuelve a conectar Facebook.",
  listHeading: "PÁGINAS QUE ADMINISTRAS",
  badgeConnected: "ya conectada",
  badgeForeign: "en otra cuenta",
  foreignBody:
    "Ya está conectada en otra cuenta de Resender. Una página pertenece a una sola cuenta.",
  connectedBody: "Ya la tienes conectada y activa.",
  addOnlyHint:
    "Esta pantalla solo agrega páginas: desmarcar una página conectada nunca la desconecta.",
  atLimitHint:
    "Ya marcaste las {remainingSlots} que te permite tu plan ({maxPages} conexiones en total). Desmarca una para elegir otra, o desconecta una para liberar cupo.",
  submit: "Conectar las páginas elegidas",
  submitting: "Conectando…",
}

export const en: SelectDict = {
  eyebrow: "connections",
  title: "Choose pages",
  subtitle:
    "Choose which of the pages you manage on Facebook you want to connect to Resender.",
  back: "Back to Connections without connecting anything",
  noAuthTitle: "You haven't authorized your pages on Meta yet.",
  noAuthBody:
    "We need your authorization to list the pages you manage. Connect Facebook and come back here to choose which ones to connect.",
  planUnresolvedTitle: "We couldn't resolve your plan's limits.",
  planUnresolvedBody:
    "Write to info@resender.dev so we can review your subscription before you connect pages.",
  planHeading: "Your plan",
  planUsageBefore: "You have ",
  planUsageRange: "{activePageCount} of {maxPages}",
  planUsageAfter: " connections.",
  planUsage: "You have {activePageCount} of {maxPages} connections.",
  allowanceOne: "You can add {count} more page.",
  allowanceMany: "You can add {count} more pages.",
  allowanceNone:
    "You're out of quota: disconnect a page to free up a slot and connect another one.",
  emptyTitle: "There are no pages you can connect yet.",
  emptyBody:
    "Meta didn't return any page you manage. Check that you gave it access to your pages and connect Facebook again.",
  listHeading: "PAGES YOU MANAGE",
  badgeConnected: "already connected",
  badgeForeign: "on another account",
  foreignBody:
    "It's already connected on another Resender account. A page belongs to a single account.",
  connectedBody: "You already have it connected and active.",
  addOnlyHint:
    "This screen only adds pages: unchecking a connected page never disconnects it.",
  atLimitHint:
    "You've already checked the {remainingSlots} your plan allows ({maxPages} connections in total). Uncheck one to pick another, or disconnect one to free up a slot.",
  submit: "Connect the selected pages",
  submitting: "Connecting…",
}
