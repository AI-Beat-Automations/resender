/**
 * Cuenta restringida de un cliente (issue #154): el padre perdió su
 * suscripción. Misma pantalla que ve el padre, sin CTA de pago: el cliente
 * nunca ve planes ni precios. `{owner}` es el nombre del padre.
 */
export type ClientRestrictedDict = {
  eyebrow: string
  title: string
  body: string
  /** Sin padre resuelto (cliente con acceso todavía no activo). */
  bodyNoOwner: string
  signOut: string
}

export const es: ClientRestrictedDict = {
  eyebrow: "acceso",
  title: "Tu acceso está en pausa.",
  body: "La cuenta de {owner}, que administra tu acceso, no tiene una suscripción activa. Tus conexiones y tu inbox vuelven en cuanto se reactive; no tienes que hacer nada.",
  bodyNoOwner:
    "Tu acceso todavía no está activo. Pídele a quien te invitó que revise tu invitación.",
  signOut: "Cerrar sesión",
}

export const en: ClientRestrictedDict = {
  eyebrow: "access",
  title: "Your access is paused.",
  body: "The account of {owner}, which manages your access, has no active subscription. Your connections and inbox come back as soon as it's reactivated; there's nothing you need to do.",
  bodyNoOwner:
    "Your access is not active yet. Ask the person who invited you to check your invitation.",
  signOut: "Sign out",
}
