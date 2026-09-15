"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { getSession } from "@/lib/auth/session"
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
import {
  formatMetaConnectionError,
  metaPageOwnedReason,
} from "@/lib/pages/meta-connection-error"
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
import { accountFields, describeError, log } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"
import { getAppDict } from "@/lib/i18n/app-dict"
import type { AppDict } from "@/content/i18n/app"

export type ConnectMetaActionState = {
  error?: string
  message?: string
}

// Los fallos que también puede devolver el callback de Meta se redactan desde
// el módulo de dominio (ADR 0005): el mismo problema, el mismo texto, llegue el
// usuario por el redirect o por esta server action. Ya no es una constante de
// módulo porque depende del idioma de quien está conectando, que sale de la
// cookie y por lo tanto de la petición.
const expiredAuthorization = (t: AppDict) =>
  formatMetaConnectionError("meta_session_expired", t)

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
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  // Los mismos gates que protegen `/api/meta/start` y `/api/meta/callback`. El
  // layout de `(product)` no alcanza: una server action se puede invocar por
  // POST directo sin renderizar la pantalla, y la fila de `subscriptions` de un
  // tenant dado de baja conserva su `price_lookup_key`.
  if (await isUserWaitlisted(session.user.id)) {
    return { error: t.actions.waitlisted }
  }
  if (!(await hasActiveSubscription(session.user.id))) {
    return { error: t.actions.noSubscription }
  }

  const selectedPageIds = formData
    .getAll("pageIds")
    .filter((value): value is string => typeof value === "string")
  if (selectedPageIds.length === 0) {
    return { error: t.actions.selectOnePage }
  }

  const result = await connectSelectedPages(session.user.id, selectedPageIds, t)
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
  selectedPageIds: string[],
  t: AppDict
): Promise<ConnectOutcome> {
  const userToken = await getMetaUserAccessToken(tenantId)
  if (!userToken) return failed(expiredAuthorization(t))

  let metaPages: ConnectedPage[]
  try {
    metaPages = await listAuthorizedPages(userToken)
  } catch (error) {
    log({
      entrypoint: "action",
      action: "account_connect",
      outcome: "failed",
      reason: "profile_fetch_failed",
      channel: "messenger",
      tenantId,
      errorMessage: describeError(error),
    })
    return failed(expiredAuthorization(t))
  }

  const [subscription, activePageCount, ownership] = await Promise.all([
    getSubscriptionByTenantId(tenantId),
    countActivePages(tenantId),
    getPageOwnership(metaPages.map((page) => page.pageId)),
  ])

  const limits = resolvePlanLimits(subscription?.priceLookupKey ?? null)
  if (!limits) {
    return failed(t.actions.planUnresolved)
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

  const validated = validatePageSelection({ view, selectedPageIds }, t)
  if (!validated.ok) return failed(validated.message)
  if (validated.value.length === 0) {
    return failed(t.actions.selectOneNewPage)
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

    for (const page of connectedPages) {
      log({
        entrypoint: "action",
        action: "account_connect",
        outcome: "ok",
        ...accountFields(page),
      })
    }

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
      // Una línea por página que no quedó suscrita: una cuenta guardada que no
      // recibe eventos se ve conectada y está muda, que es el modo de falla más
      // caro de esta integración.
      for (const accountId of error.failedPageIds) {
        log({
          entrypoint: "action",
          action: "webhook_subscribe",
          outcome: "failed",
          reason: "subscription_failed",
          channel: "messenger",
          tenantId,
          accountId,
        })
      }
      return failed(formatMetaConnectionError("webhook_subscription_failed", t))
    }
    if (error instanceof PageOwnershipError) {
      log({
        entrypoint: "action",
        action: "account_connect",
        outcome: "failed",
        reason: "account_owned_by_other_tenant",
        channel: "messenger",
        tenantId,
        accountId: error.metaPageId,
      })
      return failed(
        formatMetaConnectionError(metaPageOwnedReason(error.metaPageId), t)
      )
    }
    if (error instanceof SecretEncryptionConfigError) {
      log({
        entrypoint: "action",
        action: "account_connect",
        outcome: "failed",
        reason: "configuration_failed",
        channel: "messenger",
        tenantId,
        errorMessage: describeError(error),
      })
      return failed(formatMetaConnectionError("configuration_failed", t))
    }
    log({
      entrypoint: "action",
      action: "account_connect",
      outcome: "failed",
      reason: "internal_error",
      channel: "messenger",
      tenantId,
      errorMessage: describeError(error),
    })
    return failed(t.actions.connectFailed)
  }
}
