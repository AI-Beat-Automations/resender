"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { resolvePlanLimits } from "@/lib/billing/entitlements"
import {
  getSubscriptionByTenantId,
  hasActiveSubscription,
} from "@/lib/billing/subscription"
import {
  assertSecretEncryptionConfigured,
  SecretEncryptionConfigError,
} from "@/lib/crypto/encryption"
import {
  listAuthorizedPages,
  subscribePagesToWebhook,
  WebhookSubscriptionError,
  type ConnectedPage,
} from "@/lib/meta"
import { getMetaUserAccessToken } from "@/lib/pages/meta-user-token"
import {
  connectAuthorizedPages,
  countActivePages,
  getPageOwnership,
  PageOwnershipError,
} from "@/lib/pages/page-registry"
import {
  classifyPagesForSelection,
  validatePageSelection,
} from "@/lib/pages/page-selection"
import { posthog } from "@/lib/posthog"

export type ConnectMetaActionState = {
  error?: string
  message?: string
}

const EXPIRED_AUTHORIZATION =
  "Your Meta authorization expired. Connect Facebook again."

type PublicPage = { id: string; name: string }

type ConnectOutcome =
  | { ok: true; pages: PublicPage[] }
  | { ok: false; state: ConnectMetaActionState }

const failed = (error: string): ConnectOutcome => ({
  ok: false,
  state: { error },
})

export async function connectSelectedPagesAction(
  _state: ConnectMetaActionState,
  formData: FormData
): Promise<ConnectMetaActionState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Not authenticated." }

  // Los mismos gates que protegen `/api/meta/start` y `/api/meta/callback`. El
  // layout de `(product)` no alcanza: una server action se puede invocar por
  // POST directo sin renderizar la pantalla, y la fila de `subscriptions` de un
  // tenant dado de baja conserva su `price_lookup_key`.
  if (await isUserWaitlisted(session.user.id)) {
    return { error: "Your account is on the waitlist." }
  }
  if (!(await hasActiveSubscription(session.user.id))) {
    return { error: "Your subscription isn't active." }
  }

  const selectedPageIds = formData
    .getAll("pageIds")
    .filter((value): value is string => typeof value === "string")
  if (selectedPageIds.length === 0) {
    return { error: "Select at least one Page." }
  }

  const result = await connectSelectedPages(session.user.id, selectedPageIds)
  if (!result.ok) return result.state

  revalidatePath("/connections")
  // redirect() lanza: fuera del try/catch para que nadie lo confunda con un
  // fallo de la conexión.
  redirect(
    `/connections?meta=connected&pages=${encodeURIComponent(
      JSON.stringify(result.pages)
    )}`
  )
}

// Todo se vuelve a derivar en el servidor: el formulario solo aporta qué ids
// marcó el usuario. La conexión sigue siendo all-or-nothing, pero **sobre el
// subconjunto seleccionado** (ADR 0004): los page access tokens de las páginas
// que no eligió nunca se persisten.
async function connectSelectedPages(
  tenantId: string,
  selectedPageIds: string[]
): Promise<ConnectOutcome> {
  const userToken = await getMetaUserAccessToken(tenantId)
  if (!userToken) return failed(EXPIRED_AUTHORIZATION)

  let metaPages: ConnectedPage[]
  try {
    metaPages = await listAuthorizedPages(userToken)
  } catch (error) {
    console.error("meta pages fetch failed", error)
    return failed(EXPIRED_AUTHORIZATION)
  }

  const [subscription, activePageCount, ownership] = await Promise.all([
    getSubscriptionByTenantId(tenantId),
    countActivePages(tenantId),
    getPageOwnership(metaPages.map((page) => page.pageId)),
  ])

  const limits = resolvePlanLimits(subscription?.priceLookupKey ?? null)
  if (!limits) {
    return failed(
      "We couldn't resolve the limits of your plan. Contact support at info@resender.dev."
    )
  }

  const view = classifyPagesForSelection({
    metaPages: metaPages.map((page) => ({
      pageId: page.pageId,
      name: page.name,
    })),
    ownership,
    tenantId,
    activePageCount,
    maxPages: limits.maxPages,
  })

  const validated = validatePageSelection({ view, selectedPageIds })
  if (!validated.ok) return failed(validated.message)
  if (validated.value.length === 0) {
    return failed("Select at least one new Page to connect.")
  }

  const byPageId = new Map(metaPages.map((page) => [page.pageId, page]))
  const selected = validated.value.flatMap((page) => {
    const authorized = byPageId.get(page.pageId)
    return authorized ? [authorized] : []
  })

  try {
    assertSecretEncryptionConfigured()
    await subscribePagesToWebhook(selected)
    const connectedPages = await connectAuthorizedPages(tenantId, selected)

    if (posthog) {
      for (const page of connectedPages) {
        posthog.capture({
          distinctId: tenantId,
          event: "page connected",
          properties: { page_id: page.metaPageId, page_name: page.name },
        })
      }
      await posthog.flush()
    }

    // Solo exponemos id + name en la URL; el token queda cifrado en Postgres.
    return {
      ok: true,
      pages: connectedPages.map((page) => ({
        id: page.metaPageId,
        name: page.name,
      })),
    }
  } catch (error) {
    if (posthog) posthog.captureException(error, tenantId)
    if (error instanceof WebhookSubscriptionError) {
      console.error("webhook subscription failed", {
        pageIds: error.failedPageIds,
      })
      return failed(
        "Meta didn't confirm the webhook subscription for every selected Page. No Page was saved as connected."
      )
    }
    if (error instanceof PageOwnershipError) {
      return failed(
        `Page ${error.metaPageId} already belongs to another Resender account.`
      )
    }
    if (error instanceof SecretEncryptionConfigError) {
      return failed("Server secret encryption isn't configured.")
    }
    console.error("meta page connection failed", error)
    return failed("Couldn't connect the selected Pages. Please try again.")
  }
}
