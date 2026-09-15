// Iniciales del avatar del sidebar (ADR 0005). Desde el cutover a Better Auth
// (ADR 0014) el alta pide el nombre, así que la identidad visible sale de ahí;
// el email queda como respaldo para las filas que todavía tienen `name` vacío
// —las cuentas anteriores al cutover, que dependen de
// `scripts/seed-credentials.mjs`— y para el nombre que solo trae espacios. No
// hay pantalla para editar el nombre, así que el respaldo no es transitorio.

const SEPARATORS = /[._+-]+/
const WHITESPACE = /\s+/

export function initialsFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? ""
  return initialsFromSegments(local.split(SEPARATORS))
}

export function initialsFromName(name: string): string {
  return initialsFromSegments(name.trim().split(WHITESPACE))
}

/**
 * Lo que dibuja el avatar. El nombre manda; el email solo entra si el nombre no
 * da ninguna letra.
 */
export function accountInitials(name: string, email: string): string {
  const fromName = initialsFromName(name)
  return fromName === "?" ? initialsFromEmail(email) : fromName
}

function initialsFromSegments(rawSegments: string[]): string {
  const segments = rawSegments.filter(Boolean)

  const first = segments[0]
  if (!first) return "?"

  const second = segments[1]
  // Con más de un segmento usamos la inicial de los dos primeros; si no, las
  // dos primeras letras del único segmento disponible.
  const initials = second
    ? first.slice(0, 1) + second.slice(0, 1)
    : first.slice(0, 2)

  return initials.toUpperCase()
}
