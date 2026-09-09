import { fmt, type AppDict } from "@/content/i18n/app"

// Formato del log de Inbox. Módulo puro compartido por los dos modos de la
// pantalla —mensajes y comentarios—, porque un comentario y un DM se fechan y
// se sellan igual: el canal cambia de dónde vienen, no cómo se leen.
//
// Vivía dentro de `lib/messages/display.ts`. Se sacó de ahí cuando apareció el
// modo comentarios: `comments -> messages` sería una dependencia al revés, y
// «inbox» es el concepto que hoy cubre a los dos.

// Los tres formatos, cacheados por locale: construir un `Intl.DateTimeFormat`
// por fila es caro, y el log dibuja cientos. La clave es el `intl` del
// diccionario (`es-ES`, `en-US`), así que son dos entradas como mucho.
const formats = new Map<string, ReturnType<typeof buildFormats>>()

function buildFormats(intl: string) {
  return {
    time: new Intl.DateTimeFormat(intl, {
      hour: "2-digit",
      minute: "2-digit",
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
 * `entrante · 14:01` · `respuesta · 14:02`, el patrón del metadato de burbuja
 * (mock `1h`, ADR 0018).
 *
 * La dirección se traduce y el `status` interno ya no va: lo que el usuario
 * necesita leer es si salió o no, y eso lo dice la entrega (`entrega: leído`,
 * `entrega: no entregado`) que se añade detrás, más el estilo de la burbuja
 * fallida. Los segundos se quedaron con el formato viejo: para correlacionar
 * con logs está el id del mensaje, no la hora.
 */
export function formatMessageMeta(
  entry: {
    direction: "inbound" | "outbound"
    createdAt: Date
  },
  t: AppDict
) {
  return `${t.log.direction[entry.direction]} · ${formatTime(entry.createdAt, t)}`
}

/** `14:02`, la hora suelta del metadato. */
export function formatTime(value: Date, t: AppDict) {
  return formatsFor(t.intl).time.format(value)
}

function daysBetween(value: Date, now: Date) {
  const start = startOfDay(value).getTime()
  const reference = startOfDay(now).getTime()
  return Math.round((reference - start) / 86_400_000)
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}
