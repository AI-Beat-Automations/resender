import { getCloudflareContext } from "@opennextjs/cloudflare"
import { headers } from "next/headers"

// Rate limit por IP de los intentos de acceso y de alta, con el binding nativo
// `ratelimits` de Cloudflare (`wrangler.jsonc`), mismo patrón que
// `lib/waitlist/rate-limit.ts` y que `apps/api`.
//
// Se aplica en **dos puertas**, y las dos hacen falta: los server actions de
// `/login` y `/register`, y el `POST` de `app/api/auth/[...all]/route.ts`. El
// route handler queda públicamente expuesto y se puede martillar con `curl`
// salteándose por completo los server actions, así que limitar solo en los
// actions no limita nada.
//
// `true` = puede seguir; `false` = límite excedido.
export async function allowAuthAttempt(
  requestHeaders?: Headers
): Promise<boolean> {
  const limiter = getAuthRateLimiter()

  // Fail-open explícito, igual que el de la lista de espera: sin binding no hay
  // límite. El binding no existe en `next dev` ni en vitest, y dejar esto
  // fail-closed haría imposible entrar al producto en desarrollo local. En
  // producción y en staging está declarado en `wrangler.jsonc`, así que este
  // camino solo se toma fuera del Worker.
  if (!limiter) return true

  const key = authRateLimitKey(requestHeaders ?? (await headers()))
  const result = await limiter.limit({ key })
  return result.success
}

function getAuthRateLimiter(): RateLimit | null {
  try {
    // `getCloudflareContext` lanza cuando se llama fuera del Worker (build,
    // `next dev` sin `wrangler dev`, vitest): se trata igual que la ausencia
    // del binding.
    return getCloudflareContext().env.AUTH_RATE_LIMITER ?? null
  } catch {
    return null
  }
}

// `cf-connecting-ip` lo pone Cloudflare y el cliente no lo puede falsear
// llegando por el borde, así que va **primero**; `x-forwarded-for` es el
// fallback y puede traer una cadena de proxies, de la que solo sirve el primer
// valor (el cliente original).
export function authRateLimitKey(requestHeaders: Headers): string {
  const connectingIp = requestHeaders.get("cf-connecting-ip")?.trim()
  if (connectingIp) return connectingIp

  const forwardedFor = requestHeaders.get("x-forwarded-for")
  const firstForwarded = forwardedFor?.split(",")[0]?.trim()
  if (firstForwarded) return firstForwarded

  // Sin IP resoluble todos comparten una misma clave: es más restrictivo que
  // dejarlos pasar sin contar, y solo ocurre si el request no vino por el borde.
  return "unknown"
}
