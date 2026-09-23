export type SubscriptionDict = {
  title: string
  /** Badge del plan Free derivado (ADR 0022). */
  freeBadge: string
  freeBody: string
  /** `{status}`: la suscripción de pago que dejó de estar activa. */
  lapsedBody: string
  upgrade: string
  planLabel: string
  renewsLabel: string
  resetsLabel: string
  cancelsLabel: string
  connectionsLabel: string
  /** `{price}` */
  perMonth: string
  periodMessages: string
  usageAria: string
  limitsUnresolved: string
  managePortal: string
  portalHint: string
}

export const es: SubscriptionDict = {
  title: "Suscripción",
  freeBadge: "free",
  freeBody:
    "Estás en el plan Free: 2,000 mensajes al mes y 1 conexión, sin tarjeta. El consumo se reinicia el día 1 de cada mes.",
  lapsedBody:
    "Tu suscripción de pago ya no está activa ({status}), así que la cuenta volvió al plan Free.",
  upgrade: "Mejorar plan",
  planLabel: "plan",
  renewsLabel: "renueva",
  resetsLabel: "reinicia",
  cancelsLabel: "cancela",
  connectionsLabel: "conexiones",
  perMonth: " · ${price} / mes",
  periodMessages: "Mensajes de este período",
  usageAria: "Consumo de mensajes del período",
  limitsUnresolved:
    "No pudimos resolver los límites de tu plan, así que no podemos mostrarte el consumo. Escríbenos a",
  managePortal: "Administrar suscripción",
  portalHint:
    "Cambia de plan, actualiza tu método de pago o cancela en el portal de clientes de Stripe.",
}

export const en: SubscriptionDict = {
  title: "Subscription",
  freeBadge: "free",
  freeBody:
    "You're on the Free plan: 2,000 messages a month and 1 connection, no card. Usage resets on the 1st of every month.",
  lapsedBody:
    "Your paid subscription is no longer active ({status}), so the account went back to the Free plan.",
  upgrade: "Upgrade plan",
  planLabel: "plan",
  renewsLabel: "renews",
  resetsLabel: "resets",
  cancelsLabel: "cancels",
  connectionsLabel: "connections",
  perMonth: " · ${price} / month",
  periodMessages: "Messages this period",
  usageAria: "Message usage for the period",
  limitsUnresolved:
    "We couldn't resolve your plan's limits, so we can't show you your usage. Write to",
  managePortal: "Manage subscription",
  portalHint:
    "Change plan, update your payment method or cancel in Stripe's customer portal.",
}
