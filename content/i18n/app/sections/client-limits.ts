// Cupo del cliente al conectar (issue #154, ticket 3). Todos los textos
// nombran al padre (`{owner}`) y ninguno menciona planes ni precios.
export type ClientLimitsDict = {
  /** Cómo se nombra al padre si no se pudo resolver su nombre. */
  ownerFallback: string
  /** Cabecera del contador `n / m` del cliente en Conexiones y en la selección. */
  heading: string
  /** Sufijo del contador `n / m` de la cabecera de Conexiones. */
  counterSuffix: string
  nearTitle: string
  /** `{owner}`, `{activePageCount}`, `{maxConnections}` */
  nearBody: string
  reachedTitle: string
  /** `{owner}`, `{activePageCount}`, `{maxConnections}` */
  reachedBody: string
  tenantReachedTitle: string
  /** `{owner}` */
  tenantReachedBody: string
  /** `{owner}` */
  rejectedOwn: string
  /** `{owner}` */
  rejectedTenant: string
  /** `{remainingSlots}` */
  selectAtLimitHint: string
  /** `{remainingSlots}` */
  selectionOverflow: string
  /** Fallo al leer el tope o el cupo: fail-closed, sin nombrar el plan. */
  checkFailed: string
  /**
   * El cliente no puede conectar porque su acceso está en pausa (el padre
   * sin suscripción activa o la invitación aún pendiente). Sin nombrar la
   * suscripción: es del padre.
   */
  accessRestricted: string
}

export const es: ClientLimitsDict = {
  ownerFallback: "quien administra tu acceso",
  heading: "Tu tope",
  counterSuffix: "conexiones de tu tope",
  nearTitle: "Te estás acercando a tu tope de conexiones.",
  nearBody:
    "Tienes {activePageCount} de {maxConnections}. Si vas a necesitar más, contacta a {owner}.",
  reachedTitle: "Llegaste a tu tope de conexiones.",
  reachedBody:
    "Tienes {activePageCount} de {maxConnections}. Para conectar más, contacta a {owner}.",
  tenantReachedTitle: "No hay cupo disponible ahora mismo.",
  tenantReachedBody:
    "La cuenta de {owner} no tiene cupo libre para nuevas conexiones. Contacta a {owner} para conectar más.",
  rejectedOwn:
    "No se pudo conectar: llegaste a tu tope de conexiones. Contacta a {owner} para conectar más.",
  rejectedTenant:
    "No se pudo conectar: la cuenta de {owner} no tiene cupo libre ahora mismo. Contacta a {owner} para conectar más.",
  selectAtLimitHint:
    "Ya marcaste las {remainingSlots} que te quedan de tu tope. Desmarca una para elegir otra, o desconecta una para liberar cupo.",
  selectionOverflow:
    "Puedes añadir {remainingSlots} como máximo dentro de tu tope. Desmarca las que sobren o desconecta una para liberar cupo.",
  checkFailed:
    "No pudimos comprobar tu cupo ahora mismo. Vuelve a intentarlo en un momento.",
  accessRestricted:
    "Tu acceso está en pausa. Contacta a quien administra tu acceso.",
}

export const en: ClientLimitsDict = {
  ownerFallback: "the person who manages your access",
  heading: "Your limit",
  counterSuffix: "connections of your limit",
  nearTitle: "You're getting close to your connection limit.",
  nearBody:
    "You have {activePageCount} of {maxConnections}. If you're going to need more, contact {owner}.",
  reachedTitle: "You've reached your connection limit.",
  reachedBody:
    "You have {activePageCount} of {maxConnections}. To connect more, contact {owner}.",
  tenantReachedTitle: "There's no room available right now.",
  tenantReachedBody:
    "The account of {owner} has no free room for new connections. Contact {owner} to connect more.",
  rejectedOwn:
    "Couldn't connect: you've reached your connection limit. Contact {owner} to connect more.",
  rejectedTenant:
    "Couldn't connect: the account of {owner} has no free room right now. Contact {owner} to connect more.",
  selectAtLimitHint:
    "You've already checked the {remainingSlots} left in your limit. Uncheck one to pick another, or disconnect one to free up a slot.",
  selectionOverflow:
    "You can add at most {remainingSlots} within your limit. Uncheck the extra ones, or disconnect one to free up a slot.",
  checkFailed:
    "We couldn't check your limit right now. Please try again in a moment.",
  accessRestricted:
    "Your access is paused. Contact the person who manages your access.",
}
