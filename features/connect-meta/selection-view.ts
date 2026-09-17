import "server-only"

import { resolvePlanLimits } from "@/lib/billing/entitlements"
import { getSubscriptionByTenantId } from "@/lib/billing/subscription"
import type { Actor } from "@/lib/clients/actor"
import {
  formatClientConnectRejection,
  type ClientLimits,
} from "@/lib/clients/client-limits"
import { getClientLimits } from "@/lib/clients/client-limits-status"
import { countActivePages, getPageOwnership } from "@/lib/pages/page-registry"
import {
  classifyPagesForSelection,
  type MetaPageSummary,
  type PageSelectionView,
} from "@/lib/pages/page-selection"
import { fmt, type AppDict } from "@/content/i18n/app"

// La vista de la selección de páginas **por actor** (issue #154, ticket 3).
// La pantalla `/connections/select` y la server action de conexión derivan lo
// mismo y por eso lo comparten: el padre sigue con el cupo de su plan, y el
// cliente ve su tope acotado por lo que le queda al plan del padre
// (`client-limits`), con el mismo `remainingSlots` en la cabecera, en el
// formulario y en la validación del servidor.

export type SelectionClientContext = {
  limits: ClientLimits
  ownerName: string | null
}

export type SelectionContext =
  | {
      ok: true
      view: PageSelectionView
      /** Nulo para el padre. */
      client: SelectionClientContext | null
    }
  | { ok: false; reason: "plan_unresolved" | "client_not_found" }

export async function resolveSelectionContext(
  actor: Actor,
  metaPages: MetaPageSummary[]
): Promise<SelectionContext> {
  const ownershipPromise = getPageOwnership(
    metaPages.map((page) => page.pageId)
  )

  if (actor.clientAccountId !== null) {
    const [status, ownership] = await Promise.all([
      getClientLimits({
        tenantId: actor.tenantId,
        clientAccountId: actor.clientAccountId,
      }),
      ownershipPromise,
    ])
    if (!status.ok) return { ok: false, reason: status.reason }

    const { limits } = status
    const view = classifyPagesForSelection({
      metaPages,
      ownership,
      tenantId: actor.tenantId,
      // Lo que el cliente ve es **su** tope, no el plan del padre; pero los
      // huecos son los que caben en los dos límites.
      activePageCount: limits.clientActiveCount,
      maxPages: limits.clientMaxConnections ?? limits.planMaxPages,
    })

    return {
      ok: true,
      view: { ...view, remainingSlots: limits.remainingSlots },
      client: { limits, ownerName: status.ownerName },
    }
  }

  const [subscription, activePageCount, ownership] = await Promise.all([
    getSubscriptionByTenantId(actor.tenantId),
    countActivePages(actor.tenantId),
    ownershipPromise,
  ])

  // Plan desconocido = fail-closed, igual que el resto de los gates: no
  // dejamos conectar páginas sin límite resuelto.
  const limits = resolvePlanLimits(subscription?.priceLookupKey ?? null)
  if (!limits) return { ok: false, reason: "plan_unresolved" }

  return {
    ok: true,
    view: classifyPagesForSelection({
      metaPages,
      ownership,
      tenantId: actor.tenantId,
      activePageCount,
      maxPages: limits.maxPages,
    }),
    client: null,
  }
}

// El texto con el que se rechaza pasarse del cupo cuando el actor es un
// cliente: en el tope (propio o del padre) nombra al padre; con huecos pero
// menos de los marcados, dice cuántos caben. Nunca habla del plan.
export function clientLimitMessage(
  client: SelectionClientContext,
  t: AppDict
): string {
  const { limits, ownerName } = client
  if (limits.verdict !== "allowed") {
    return formatClientConnectRejection(limits.verdict, ownerName, t)
  }
  return fmt(t.clientLimits.selectionOverflow, {
    remainingSlots: limits.remainingSlots,
  })
}
