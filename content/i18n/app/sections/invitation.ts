/**
 * `/invitacion/[token]` (issue #154, ticket #156): el cliente acepta, fija
 * su contraseña y entra. Los cuatro estados sin acción —vencida, cancelada,
 * ya usada, desconocida— explican y no ofrecen nada: el padre reenvía.
 */
export type InvitationDict = {
  eyebrow: string
  title: string
  /** `{owner}`: el nombre del padre. */
  body: string
  nameLabel: string
  emailLabel: string
  passwordLabel: string
  passwordPlaceholder: string
  passwordHint: string
  confirmPasswordLabel: string
  confirmPasswordPlaceholder: string
  submit: string
  submitting: string
  expiredTitle: string
  expiredBody: string
  cancelledTitle: string
  cancelledBody: string
  consumedTitle: string
  consumedBody: string
  unknownTitle: string
  unknownBody: string
}

export const es: InvitationDict = {
  eyebrow: "invitación",
  title: "Crea tu acceso.",
  body: "{owner} te invitó a Resender para que conectes tus redes con tu propio login de Meta. Elige una contraseña y entras directo.",
  nameLabel: "Tu nombre",
  emailLabel: "Correo",
  passwordLabel: "Contraseña",
  passwordPlaceholder: "Al menos 8 caracteres",
  passwordHint: "Mínimo 8 caracteres.",
  confirmPasswordLabel: "Repetir contraseña",
  confirmPasswordPlaceholder: "Repite la contraseña",
  submit: "Crear mi acceso",
  submitting: "Creando…",
  expiredTitle: "Este enlace venció.",
  expiredBody:
    "Las invitaciones duran 7 días. Pídele a quien te invitó que te la reenvíe: te llegará un enlace nuevo.",
  cancelledTitle: "Esta invitación se canceló.",
  cancelledBody:
    "Quien te invitó la retiró. Si crees que es un error, pídele que te mande una nueva.",
  consumedTitle: "Este enlace ya se usó.",
  consumedBody:
    "Tu acceso ya está creado: entra con tu correo y tu contraseña. Si no fuiste tú, pídele a quien te invitó que te mande una invitación nueva.",
  unknownTitle: "Este enlace no es válido.",
  unknownBody:
    "Revisa que hayas copiado la dirección completa del correo. Si sigue sin funcionar, pídele a quien te invitó que te la reenvíe.",
}

export const en: InvitationDict = {
  eyebrow: "invitation",
  title: "Create your access.",
  body: "{owner} invited you to Resender so you can connect your social accounts with your own Meta login. Pick a password and you're in.",
  nameLabel: "Your name",
  emailLabel: "Email",
  passwordLabel: "Password",
  passwordPlaceholder: "At least 8 characters",
  passwordHint: "Minimum 8 characters.",
  confirmPasswordLabel: "Repeat password",
  confirmPasswordPlaceholder: "Repeat the password",
  submit: "Create my access",
  submitting: "Creating…",
  expiredTitle: "This link has expired.",
  expiredBody:
    "Invitations last 7 days. Ask the person who invited you to resend it: you'll get a fresh link.",
  cancelledTitle: "This invitation was cancelled.",
  cancelledBody:
    "The person who invited you withdrew it. If you think that's a mistake, ask them for a new one.",
  consumedTitle: "This link was already used.",
  consumedBody:
    "Your access already exists: sign in with your email and password. If that wasn't you, ask the person who invited you for a new invitation.",
  unknownTitle: "This link is not valid.",
  unknownBody:
    "Check that you copied the full address from the email. If it still doesn't work, ask the person who invited you to resend it.",
}
