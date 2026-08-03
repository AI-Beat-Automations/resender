import { getCloudflareContext } from "@opennextjs/cloudflare"
import { headers } from "next/headers"

// Rate limit por IP del formulario público de la lista de espera, con el
// binding nativo `ratelimits` de Cloudflare (`wrangler.jsonc`), mismo patrón
// que ya corre en `apps/api` (`apps/api/src/http/app.ts:309`). Es la tercera
// capa de protección de la primera escritura anónima del repo, junto al
// honeypot y al unique index sobre `lower(email)` (ADR 0007).
//
// `true` = puede seguir; `false` = límite excedido.
export async function allowWaitlistSignup(): Promise<boolean> {
  const limiter = getWaitlistRateLimiter()

  // Fail-open explícito: sin binding no hay límite. El binding no existe en
  // `next dev` ni en vitest, y dejar esto fail-closed rompería el desarrollo
  // local y los tests para proteger un formulario que además tiene honeypot y
  // unique index. En producción el binding está declarado en `wrangler.jsonc`,
  // así que este camino solo se toma fuera del Worker.
  if (!limiter) return true

  const key = await resolveClientIp()
  const result = await limiter.limit({ key })
  return result.success
}

function getWaitlistRateLimiter(): RateLimit | null {
  try {
    // `getCloudflareContext` lanza cuando se llama fuera del Worker (build,
    // `next dev` sin `wrangler dev`, vitest): se trata igual que la ausencia
    // del binding.
    return getCloudflareContext().env.WAITLIST_RATE_LIMITER ?? null
  } catch {
    return null
  }
}

// `cf-connecting-ip` lo pone Cloudflare y el cliente no lo puede falsear
// llegando por el borde; `x-forwarded-for` es el fallback y puede traer una
// cadena de proxies, de la que solo sirve el primer valor (el cliente original).
async function resolveClientIp(): Promise<string> {
  const requestHeaders = await headers()

  const connectingIp = requestHeaders.get("cf-connecting-ip")?.trim()
  if (connectingIp) return connectingIp

  const forwardedFor = requestHeaders.get("x-forwarded-for")
  const firstForwarded = forwardedFor?.split(",")[0]?.trim()
  if (firstForwarded) return firstForwarded

  // Sin IP resoluble todos comparten una misma clave: es más restrictivo que
  // dejarlos pasar sin contar, y solo ocurre si el request no vino por el borde.
  return "unknown"
}
