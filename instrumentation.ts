import * as Sentry from "@sentry/nextjs"

// Convención `instrumentation.ts` de Next: `register` corre una vez por
// instancia del servidor, antes de atender requests. El cliente se inicializa
// aparte, en `instrumentation-client.ts`.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

// Captura los errores no manejados de páginas, RSC, server actions y route
// handlers sin tener que envolver cada uno.
export const onRequestError = Sentry.captureRequestError
