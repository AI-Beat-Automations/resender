import { describe, expect, it } from "vitest"

import { allowAuthAttempt, authRateLimitKey } from "@/lib/auth/rate-limit"

// Se prueba la **decisión**, no la red: el binding `ratelimits` solo existe
// dentro del Worker de Cloudflare, así que en vitest no hay nada que contar.
// Lo que sí se puede fijar acá es qué pasa cuando el binding no está y de qué
// header sale la clave.

describe("allowAuthAttempt", () => {
  it("deja pasar cuando no hay binding (fail-open explícito)", async () => {
    // `getCloudflareContext()` lanza fuera del Worker, que es exactamente el
    // caso de `next dev` y de este test. Fail-closed acá haría imposible entrar
    // al producto en desarrollo local.
    await expect(
      allowAuthAttempt(new Headers({ "cf-connecting-ip": "203.0.113.7" }))
    ).resolves.toBe(true)
  })
})

describe("authRateLimitKey", () => {
  it("prefiere cf-connecting-ip sobre x-forwarded-for", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    })
    // `cf-connecting-ip` lo pone Cloudflare y el cliente no lo puede falsear;
    // `x-forwarded-for` sí, así que si mandara el atacante elegiría su cuota.
    expect(authRateLimitKey(headers)).toBe("203.0.113.7")
  })

  it("cae al primer valor de x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    })
    expect(authRateLimitKey(headers)).toBe("198.51.100.1")
  })

  it("agrupa bajo una sola clave cuando no hay IP resoluble", () => {
    // Más restrictivo que dejarlos pasar sin contar, y solo ocurre si el
    // request no vino por el borde.
    expect(authRateLimitKey(new Headers())).toBe("unknown")
  })
})
