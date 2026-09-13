import { cache } from "react"

import { getActor, type Actor } from "@/lib/auth/actor"

// El layout, el slot `@header` y la página resuelven el actor en la misma
// petición, y Next los renderiza en paralelo: `cache` deduplica la consulta
// dentro del render, nunca entre peticiones (ADR 0020).
export const getActorCached = cache(getActor)

/**
 * El actor para una pantalla de `(product)`. `null` cuando no hay sesión o no
 * puede entrar: el layout ya redirige en esos casos, y la página no debe
 * mostrar datos de nadie mientras tanto.
 */
export async function getProductActor(): Promise<Actor | null> {
  const resolution = await getActorCached()
  return resolution?.status === "ok" ? resolution.actor : null
}
