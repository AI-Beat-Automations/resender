// **Corrección de seguridad, no un extra.** `instrumentation-client.ts`
// inicializa PostHog en **todas** las páginas con
// `capture_pageview: "history_change"`, y cada `$pageview` lleva
// `$current_url` tomado de `window.location.href` —querystring incluido—.
//
// Sin esto, el `?token=…` del [Enlace de recuperacion] queda guardado en
// PostHog, y ese token es una credencial viva durante una hora que permite
// tomar la cuenta. PostHog retiene eventos durante meses.
//
// Módulo `.ts` puro y sin `posthog-js` adentro para que vitest lo cubra
// (vitest no ejecuta `.tsx` ni el `instrumentation-client`).

// Query keys cuyo **valor** se reescribe. Es una lista y no un solo literal
// porque el día que exista verificación de email o un magic link, el token de
// esos flujos entra por la misma puerta.
const REDACTED_QUERY_KEYS = ["token"]

const REDACTED = "redacted"

/**
 * Reescribe el valor de las query keys sensibles. Una entrada que no parsea
 * como URL vuelve **tal cual**: `before_send` corre en el camino de cada
 * evento y lanzar acá rompería la analítica entera por una cadena rara.
 */
export function redactUrl(raw: unknown): unknown {
  if (typeof raw !== "string") return raw

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }

  let touched = false
  for (const key of REDACTED_QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.set(key, REDACTED)
      touched = true
    }
  }

  return touched ? url.toString() : raw
}

// Las tres propiedades por las que la URL entra a PostHog. Solo la primera
// deja el token en la página siguiente y en las person properties, pero las
// tres lo transportan.
const REDACTED_PROPERTIES = [
  "$current_url",
  "$referrer",
  "$initial_current_url",
]

/**
 * Hook `before_send` de `posthog.init`. Devuelve el evento con las URLs
 * redactadas, o el mismo objeto si no había ninguna que tocar.
 */
export function redactEventUrls<
  T extends { properties?: Record<string, unknown> | null } | null,
>(event: T): T {
  if (!event?.properties) return event

  for (const key of REDACTED_PROPERTIES) {
    const value = event.properties[key]
    if (value === undefined) continue
    event.properties[key] = redactUrl(value)
  }

  return event
}
