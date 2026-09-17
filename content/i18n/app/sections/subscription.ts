export type SubscriptionDict = {
  title: string
  none: string
  noneBody: string
  choosePlan: string
  planLabel: string
  renewsLabel: string
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
  none: "sin suscripción",
  noneBody: "No hay ninguna suscripción registrada para esta cuenta.",
  choosePlan: "Elegir un plan",
  planLabel: "plan",
  renewsLabel: "renueva",
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
  none: "no subscription",
  noneBody: "There's no subscription on record for this account.",
  choosePlan: "Choose a plan",
  planLabel: "plan",
  renewsLabel: "renews",
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
