// Formato de la sección Logs. Módulo puro: sin React, sin Next.

/** `186 ms` bajo el segundo, `5.0 s` arriba (mock `1n`). */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** `03/09/2026 14:02`, en la zona horaria de quien mira. */
export function formatLogDate(date: Date, intl: string): string {
  const parts = new Intl.DateTimeFormat(intl, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ""
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`
}

/** Cuánto falta para el próximo reintento: `30 s`, `2 min`. Null si ya pasó. */
export function formatRetryIn(nextRetryAt: Date, now: Date): string | null {
  const seconds = Math.round((nextRetryAt.getTime() - now.getTime()) / 1000)
  if (seconds <= 0) return null
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`
}

/**
 * Un cuerpo guardado, listo para el `<pre>`: JSON con sangría si parsea, y tal
 * cual si no (una respuesta de texto del bot, o un JSON recortado a 64 KB).
 */
export function prettyBody(text: string | null): string | null {
  if (!text) return null
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Separa `POST https://host/path` para pintar el host atenuado. */
export function displayEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, "")
}
