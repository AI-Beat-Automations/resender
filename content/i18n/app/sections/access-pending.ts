/**
 * Pantalla autenticada del gate de acceso (`/pending`): el aterrizaje de la
 * cuenta que acaba de registrarse y todavía no está aprobada. No es la lista
 * de espera pública de `/waitlist`, que es marketing y vive en el otro
 * diccionario.
 */
export type AccessPendingDict = {
  eyebrow: string
  title: string
  body: string
  emailLabel: string
  helpBefore: string
  helpDocsLink: string
  helpMiddle: string
  helpAfter: string
  signOut: string
  /**
   * Bloque de [Verificacion de correo], **por encima** del mensaje de
   * aprobación y solo si `isEmailVerified()` es falso (leído vivo, no de la
   * sesión: la cookie de caché la trae vieja hasta cinco minutos).
   * `linkExpired` es lo que dice `/pending?error=TOKEN_EXPIRED` (o
   * `INVALID_TOKEN`), ya clasificado por `classifyVerificationError`.
   */
  verify: {
    title: string
    /** `{email}` */
    body: string
    resend: string
    sent: string
    linkExpired: string
  }
}

export const es: AccessPendingDict = {
  eyebrow: "acceso",
  title: "Ya estás dentro.",
  body: "Tu cuenta quedó creada y tu lugar en la lista guardado. Estamos abriendo el acceso de a poco, cuenta por cuenta: te escribimos en cuanto te toque y no tienes que hacer nada más.",
  emailLabel: "Te escribimos a",
  helpBefore: "Mientras tanto puedes leer la ",
  helpDocsLink: "documentación",
  helpMiddle: " o escribirnos a ",
  helpAfter: ".",
  signOut: "Cerrar sesión",
  verify: {
    title: "Confirma tu correo",
    body: "Te escribimos a {email} para confirmar que es tuyo. No hace falta para esperar la aprobación, pero sí para entrar con Google.",
    resend: "Reenviar confirmación",
    sent: "Listo, te lo reenviamos.",
    linkExpired: "El enlace venció, pide uno nuevo.",
  },
}

export const en: AccessPendingDict = {
  eyebrow: "access",
  title: "You're in.",
  body: "Your account is created and your spot on the list is saved. We're opening access gradually, account by account: we'll email you as soon as it's your turn, and there's nothing else for you to do.",
  emailLabel: "We'll write to",
  helpBefore: "In the meantime you can read the ",
  helpDocsLink: "documentation",
  helpMiddle: " or write to us at ",
  helpAfter: ".",
  signOut: "Sign out",
  verify: {
    title: "Confirm your email",
    body: "We emailed {email} to confirm it's yours. You don't need it to wait for approval, but you do need it to sign in with Google.",
    resend: "Resend confirmation",
    sent: "Done, we sent it again.",
    linkExpired: "The link expired. Request a new one.",
  },
}
