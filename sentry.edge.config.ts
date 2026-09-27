import * as Sentry from "@sentry/nextjs"

// Runtime `edge` de Next. Mismo criterio que `sentry.server.config.ts`.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === "production",
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
  tracesSampleRate: 0.1,
})
