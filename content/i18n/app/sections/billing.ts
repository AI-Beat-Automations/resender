export type BillingDict = {
  metaTitle: string
  eyebrow: string
  title: string
  subtitle: string
  signOut: string
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
  title: "Elige tu plan.",
  subtitle:
    "Tu cuenta está aprobada. El pago ocurre en una página segura de Stripe.",
  signOut: "Cerrar sesión",
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
  title: "Choose your plan.",
  subtitle:
    "Your account is approved. Payment happens on a secure Stripe page.",
  signOut: "Sign out",
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
