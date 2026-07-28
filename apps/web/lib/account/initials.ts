// Iniciales del avatar del sidebar (ADR 0005): el único dato de identidad que
// tenemos del usuario es su email, así que las derivamos de la parte local.

const SEPARATORS = /[._+-]+/

export function initialsFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? ""
  const segments = local.split(SEPARATORS).filter(Boolean)

  const first = segments[0]
  if (!first) return "?"

  const second = segments[1]
  // Con separadores usables tomamos la inicial de los dos primeros segmentos;
  // si no, las dos primeras letras del único segmento disponible.
  const initials = second
    ? first.slice(0, 1) + second.slice(0, 1)
    : first.slice(0, 2)

  return initials.toUpperCase()
}
