// Tipado del binding `ratelimits` declarado en `wrangler.jsonc`, para que
// `getCloudflareContext().env.WAITLIST_RATE_LIMITER` typechequee
// (`lib/waitlist/rate-limit.ts`, ADR 0007).
//
// Está escrito a mano y NO generado con `npm run cf-typegen`. El generador
// escribe `cloudflare-env.d.ts` en la raíz de la app con las ~14.700 líneas de
// tipos del runtime de workerd, y esos globals pisan los del DOM: `Response.json()`
// pasa a devolver `unknown` y `lib/meta.ts` deja de compilar con siete errores
// TS18046. Como la app corre sobre Next (no es un Worker escrito a mano como
// `apps/api`, que sí puede commitear su `worker-configuration.d.ts`), acá solo
// hace falta la forma del binding.
//
// Si algún día se corre `cf-typegen`, este archivo sobra: borralo y arreglá los
// call sites de `lib/meta.ts` en la misma entrega.

// Interfaz que `@opennextjs/cloudflare` declara global y que se amplía por
// merging, igual que `types/next-auth.d.ts` amplía `Session`.
interface CloudflareEnv {
  WAITLIST_RATE_LIMITER: RateLimit
}

// Mismo nombre y forma que genera `wrangler types`, para que sustituir este
// archivo por el generado no obligue a tocar los call sites.
interface RateLimitOptions {
  key: string
}

interface RateLimitOutcome {
  success: boolean
}

interface RateLimit {
  limit(options: RateLimitOptions): Promise<RateLimitOutcome>
}
