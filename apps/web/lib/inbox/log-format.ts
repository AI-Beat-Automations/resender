import { fmt, type AppDict } from "@/content/i18n/app"

// Formato del log de Inbox. Módulo puro compartido por los dos modos de la
// pantalla —mensajes y comentarios—, porque un comentario y un DM se fechan y
// se sellan igual: el canal cambia de dónde vienen, no cómo se leen.
//
// Vivía dentro de `lib/messages/display.ts`. Se sacó de ahí cuando apareció el
// modo comentarios: `comments -> messages` sería una dependencia al revés, y
// «inbox» es el concepto que hoy cubre a los dos.

// Los cuatro formatos, cacheados por locale: construir un `Intl.DateTimeFormat`
// por fila es caro, y el log dibuja cientos. La clave es el `intl` del
// diccionario (`es-ES`, `en-US`), así que son dos entradas como mucho.
const formats = new Map<string, ReturnType<typeof buildFormats>>()

function buildFormats(intl: string) {
  return {
    time: new Intl.DateTimeFormat(intl, {
      hour: "2-digit",
      minute: "2-digit",
    }),
    seconds: new Intl.DateTimeFormat(intl, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    day: new Intl.DateTimeFormat(intl, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    shortDay: new Intl.DateTimeFormat(intl, {
      day: "numeric",
      month: "short",
    }),
  }
}

function formatsFor(intl: string) {
  const cached = formats.get(intl)
  if (cached) return cached
  const built = buildFormats(intl)
  formats.set(intl, built)
  return built
}

/** `hoy 14:02` · `ayer 19:12` · `24 jul` · `24 jul 2025`. */
export function formatLogTimestamp(value: Date, now: Date, t: AppDict) {
  const f = formatsFor(t.intl)
  const days = daysBetween(value, now)
  if (days === 0) return fmt(t.log.today, { time: f.time.format(value) })
  if (days === 1) return fmt(t.log.yesterday, { time: f.time.format(value) })
  if (value.getFullYear() === now.getFullYear()) {
    return f.shortDay.format(value)
  }
  return f.day.format(value)
}

/** `27 jul 2026`, para el separador de fecha del hilo. */
export function formatDayLabel(value: Date, t: AppDict) {
  return formatsFor(t.intl).day.format(value)
}

/**
 * `outbound · 14:02:11 · sent`, el patrón del metadato de burbuja.
 *
 * `direction` y `status` **no se traducen**: son los valores literales de las
 * columnas, y es lo que el usuario cita cuando pregunta por qué un mensaje no
 * salió. Lo único que depende del idioma es la hora.
 */
export function formatMessageMeta(
  entry: {
    direction: string
    status: string
    createdAt: Date
  },
  t: AppDict
) {
  const time = formatsFor(t.intl).seconds.format(entry.createdAt)
  return `${entry.direction} · ${time} · ${entry.status}`
}

function daysBetween(value: Date, now: Date) {
  const start = startOfDay(value).getTime()
  const reference = startOfDay(now).getTime()
  return Math.round((reference - start) / 86_400_000)
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}
