import * as Sentry from "@sentry/nextjs"

// Runtime `nodejs` de Next, que en producción es el Worker de OpenNext sobre
// `nodejs_compat`. El SDK necesita `https.request`, que workerd trae desde el
// `compatibility_date` 2025-08-16 (el de `wrangler.jsonc` ya es posterior).
//
// Sin `dataCollection` a propósito: el default conservador no manda cookies,
// cabeceras ni cuerpos, y acá los requests llevan la cookie de sesión, API keys
// y los payloads de los webhooks de Meta.
//
// Sin `includeLocalVariables`: depende del inspector de Node, que workerd no
// tiene.
//
// Sentry Logs no se activa acá: en el SDK v11 `Sentry.logger` manda siempre que
// haya `init` (ya no existe `enableLogs`). Lo que llega es lo que emite
// `log()` de `lib/observability/logger.ts`, no la consola.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // `ENVIRONMENT` viene de `vars` en `wrangler.jsonc` (production/staging).
  environment: process.env.ENVIRONMENT ?? "development",
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
})
