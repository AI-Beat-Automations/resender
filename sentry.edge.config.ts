import * as Sentry from "@sentry/nextjs"

// Runtime `edge` de Next. Mismo criterio que `sentry.server.config.ts`.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.ENVIRONMENT ?? "development",
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
})
