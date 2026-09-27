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
//
// Solo producción reporta. `NEXT_PUBLIC_SENTRY_ENVIRONMENT` se inlinea en build
// y solo lo define `deploy.yml`: staging y local quedan con `enabled: false`
// aunque el `.env` traiga el DSN. Es el mismo interruptor que en el navegador,
// que no puede leer `ENVIRONMENT` de `wrangler.jsonc`.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === "production",
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
  tracesSampleRate: 0.1,
})
