export type BillingDict = {
  metaTitle: string
  eyebrow: string
  title: string
  subtitle: string
  signOut: string
  backToApp: string
  perMonth: string
  /** `{messages}`, `{pages}` */
  planLimitsOne: string
  /** `{messages}`, `{pages}` */
  planLimitsMany: string
  subscribe: string
  footnote: string
  successMetaTitle: string
  successTitle: string
  successBody: string
  successSlowBefore: string
  successSlowLink: string
  successSlowMiddle: string
  successSlowAfter: string
}

export const es: BillingDict = {
  metaTitle: "Suscripción",
  eyebrow: "pricing",
  title: "Mejora tu plan.",
  subtitle:
    "Estás en el plan Free. Sube de plan para tener más mensajes y conexiones; el pago ocurre en una página segura de Stripe.",
  signOut: "Cerrar sesión",
  backToApp: "Volver a Resender",
  perMonth: "/ mes",
  planLimitsOne: "{messages} mensajes · {pages} conexión",
  planLimitsMany: "{messages} mensajes · {pages} conexiones",
  subscribe: "Suscribirme",
  footnote:
    "Cambia de plan, actualiza tu tarjeta o cancela cuando quieras desde Ajustes, con el portal de Stripe.",
  successMetaTitle: "Activando tu suscripción",
  successTitle: "Activando tu suscripción…",
  successBody:
    "Gracias por suscribirte. Estamos confirmando el pago con Stripe: suele tomar unos segundos y esta página te lleva adentro sola. No hace falta que recargues ni que vuelvas a pagar.",
  successSlowBefore: "¿Tarda más de lo esperado? ",
  successSlowLink: "Abre la app",
  successSlowMiddle: " o escríbenos a ",
  successSlowAfter: ".",
}

export const en: BillingDict = {
  metaTitle: "Subscription",
  eyebrow: "pricing",
  title: "Upgrade your plan.",
  subtitle:
    "You're on the Free plan. Upgrade for more messages and connections; payment happens on a secure Stripe page.",
  signOut: "Sign out",
  backToApp: "Back to Resender",
  perMonth: "/ month",
  planLimitsOne: "{messages} messages · {pages} connection",
  planLimitsMany: "{messages} messages · {pages} connections",
  subscribe: "Subscribe",
  footnote:
    "Change plan, update your card or cancel whenever you want from Settings, with Stripe's portal.",
  successMetaTitle: "Activating your subscription",
  successTitle: "Activating your subscription…",
  successBody:
    "Thanks for subscribing. We're confirming the payment with Stripe: it usually takes a few seconds and this page takes you in on its own. You don't need to reload or pay again.",
  successSlowBefore: "Taking longer than expected? ",
  successSlowLink: "Open the app",
  successSlowMiddle: " or write to ",
  successSlowAfter: ".",
}
