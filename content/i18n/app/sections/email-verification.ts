/**
 * Barra de [Verificacion de correo] del producto: franja fija debajo del
 * header, encima de la de cuota, mientras `email_verified` sea falso (leído
 * vivo). Ya no bloquea la entrada: el Free sin confirmar navega, pero no
 * conecta redes ([Gate de correo del Free]).
 */
export type EmailVerificationDict = {
  title: string
  /** `{email}`. Cuenta del Free: confirmar es lo que le deja conectar. */
  bodyConnect: string
  /** `{email}`. Cuenta que paga o cliente: no tiene redes bloqueadas. */
  body: string
  /** El [Enlace de verificacion] venció o no es válido (`?error=`). */
  linkExpired: string
  resend: string
  sending: string
  sent: string
  /** Franja verde única al aterrizar con el enlace ya confirmado. */
  verified: string
  /** Leyenda de `/connections` con los «Conectar…» deshabilitados. */
  connectBlocked: string
}

export const es: EmailVerificationDict = {
  title: "Verifica tu correo.",
  bodyConnect: "Confirma {email} para conectar redes.",
  body: "Confirma {email} para asegurar tu cuenta.",
  linkExpired: "El enlace venció.",
  resend: "Reenviar correo",
  sending: "Enviando…",
  sent: "Enviado",
  verified: "Correo confirmado. Ya puedes conectar tus redes.",
  connectBlocked: "Confirma tu correo para conectar.",
}

export const en: EmailVerificationDict = {
  title: "Verify your email.",
  bodyConnect: "Confirm {email} to connect your channels.",
  body: "Confirm {email} to secure your account.",
  linkExpired: "The link expired.",
  resend: "Resend email",
  sending: "Sending…",
  sent: "Sent",
  verified: "Email confirmed. You can connect your channels now.",
  connectBlocked: "Confirm your email to connect.",
}
