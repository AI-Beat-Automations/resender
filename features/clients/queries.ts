import { cache } from "react"

import { resolveClientPlan } from "@/lib/clients/client-plan"

// El layout de `(product)` (para el item del sidebar) y la página de Clientes
// resuelven el plan del padre en la misma petición. `cache` deduplica la
// lectura de `subscriptions` dentro del render, sin tocar `lib/`.
export const resolveClientPlanCached = cache(resolveClientPlan)
