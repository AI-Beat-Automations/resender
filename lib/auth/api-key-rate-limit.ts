import { getCloudflareContext } from "@opennextjs/cloudflare"

// Rate limit por API key de las rutas salientes (`/api/meta/*/send`), con el
// binding nativo `ratelimits` de Cloudflare (`wrangler.jsonc`), mismo patrón
// que `lib/auth/rate-limit.ts`.
//
// Cada envío son ~10 round-trips a Neon y una llamada a Meta. Sin este límite,
// un bot del cliente en bucle pega directo a la base y a Meta hasta que alguien
// lo apaga a mano. El techo —3.000 por minuto, 50 por segundo— está por encima
// del pico real de un bot con 5.000 conversaciones al día, así que el uso
// normal no lo ve nunca; solo corta el bucle.
//
// La clave es el id de la key y no el tenant a propósito: un tenant con dos
// integraciones no debe pagar el bucle de una con la cuota de la otra.
//
// `true` = puede seguir; `false` = límite excedido.
export async function allowApiKeyRequest(apiKeyId: string): Promise<boolean> {
  const limiter = getApiKeyRateLimiter()

  // Fail-open explícito, igual que el de acceso: sin binding no hay límite. El
  // binding no existe en `next dev` ni en vitest; en producción y en staging
  // está declarado en `wrangler.jsonc`, así que este camino solo se toma fuera
  // del Worker.
  if (!limiter) return true

  const result = await limiter.limit({ key: apiKeyId })
  return result.success
}

// Segundos que el cliente debe esperar. Es el periodo del binding: el contador
// de Cloudflare se vacía por ventana, no por token, así que no hay un valor
// más fino que dar.
export const API_KEY_RATE_LIMIT_RETRY_AFTER_SECONDS = 60

function getApiKeyRateLimiter(): RateLimit | null {
  try {
    // `getCloudflareContext` lanza fuera del Worker (build, `next dev` sin
    // `wrangler dev`, vitest): se trata igual que la ausencia del binding.
    return getCloudflareContext().env.API_KEY_RATE_LIMITER ?? null
  } catch {
    return null
  }
}
