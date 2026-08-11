// Formato del log de Inbox. Módulo puro compartido por los dos modos de la
// pantalla —mensajes y comentarios—, porque un comentario y un DM se fechan y
// se sellan igual: el canal cambia de dónde vienen, no cómo se leen.
//
// Vivía dentro de `lib/messages/display.ts`. Se sacó de ahí cuando apareció el
// modo comentarios: `comments -> messages` sería una dependencia al revés, y
// «inbox» es el concepto que hoy cubre a los dos.

const TIME_FORMAT = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
})

const SECONDS_FORMAT = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

const DAY_FORMAT = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

const SHORT_DAY_FORMAT = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
})

/** `hoy 14:02` · `ayer 19:12` · `24 jul` · `24 jul 2025`. */
export function formatLogTimestamp(value: Date, now: Date) {
  const days = daysBetween(value, now)
  if (days === 0) return `hoy ${TIME_FORMAT.format(value)}`
  if (days === 1) return `ayer ${TIME_FORMAT.format(value)}`
  if (value.getFullYear() === now.getFullYear()) {
    return SHORT_DAY_FORMAT.format(value)
  }
  return DAY_FORMAT.format(value)
}

/** `27 jul 2026`, para el separador de fecha del hilo. */
export function formatDayLabel(value: Date) {
  return DAY_FORMAT.format(value)
}

/** `outbound · 14:02:11 · sent`, el patrón del metadato de burbuja. */
export function formatMessageMeta(entry: {
  direction: string
  status: string
  createdAt: Date
}) {
  return `${entry.direction} · ${SECONDS_FORMAT.format(entry.createdAt)} · ${entry.status}`
}

function daysBetween(value: Date, now: Date) {
  const start = startOfDay(value).getTime()
  const reference = startOfDay(now).getTime()
  return Math.round((reference - start) / 86_400_000)
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}
