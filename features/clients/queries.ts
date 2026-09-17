import { cache } from "react"

import { resolveActor } from "@/lib/clients/actor"
import { listClientAccountNames } from "@/lib/clients/client-accounts"
import { resolveClientPlan } from "@/lib/clients/client-plan"

// El layout de `(product)` (para el item del sidebar) y la página de Clientes
// resuelven el plan del padre en la misma petición. `cache` deduplica la
// lectura de `subscriptions` dentro del render, sin tocar `lib/`.
export const resolveClientPlanCached = cache(resolveClientPlan)

// El actor de la request (issue #154): el layout lo resuelve para el gate y el
// sidebar, y cada pantalla lo vuelve a pedir para filtrar lo suyo. Una sola
// lectura por render. La clave es el id de la sesión, que es lo único que el
// resolutor necesita: `cache` deduplica por argumentos, y un objeto de sesión
// nuevo por llamada nunca coincidiría.
export const resolveActorCached = cache((userId: string) =>
  resolveActor({ user: { id: userId } })
)

// Nombres de los clientes del padre (ticket 4): etiquetan las filas de
// Conexiones e Inbox y llenan el filtro por cliente. Página y header los piden
// en la misma petición.
export const listClientNamesCached = cache(listClientAccountNames)
