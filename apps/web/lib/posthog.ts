import { PostHog } from "posthog-node"
import { after } from "next/server"

function createPostHogClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "NEXT_PUBLIC_POSTHOG_KEY variable required by PostHog is missing or un-configured, " +
          "this causes events to be silently missed. " +
          "This error stops appearing once NEXT_PUBLIC_POSTHOG_KEY is configured"
      )
    }
    return null
  }
  return new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  })
}

export const posthog = createPostHogClient()

// Captura un evento y manda el `flush` **fuera de la respuesta**.
//
// El cliente está en `flushAt: 1`, así que cada `capture` dispara un HTTP a
// PostHog. Las rutas calientes —los tres `/send` y la ingesta de webhooks—
// hacían `await posthog.flush()` antes de responder: un round-trip a PostHog
// por mensaje, en el camino crítico, y si PostHog se degradaba subía la
// latencia de todos los envíos y Meta veía timeouts en el webhook. Acá el
// `flush` se difiere con `after()`, que en OpenNext se traduce a `waitUntil`:
// el evento sale igual, pero después de que el cliente ya tiene su respuesta.
//
// Fuera del alcance de una request —el consumidor de la cola, el cron— `after`
// lanza; en ese caso el `flush` queda como promesa suelta. Si el Worker termina
// antes, se pierde un evento de analítica, que es un costo aceptable frente a
// bloquear el consumidor por él.
export function captureDeferred(
  event: Parameters<PostHog["capture"]>[0]
): void {
  if (!posthog) return
  posthog.capture(event)
  const flush = () =>
    posthog.flush().catch((error: unknown) => {
      console.warn("posthog flush failed", error)
    })
  try {
    after(flush)
  } catch {
    void flush()
  }
}
