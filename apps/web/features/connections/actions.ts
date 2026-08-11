"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/auth"
import {
  disconnectPage,
  getActivePageWithTokenByConnectionId,
  InvalidWebhookUrlError,
  updatePageWebhookUrl,
} from "@/lib/pages/page-registry"
import { unsubscribeChannelWebhook } from "@/lib/pages/channel-webhook"
import {
  accountFields,
  describeError,
  log,
} from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

export type ConnectionActionState = {
  error?: string
  message?: string
}

export async function saveWebhookUrlAction(
  _state: ConnectionActionState,
  formData: FormData
): Promise<ConnectionActionState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No has iniciado sesión." }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: "Página inválida." }
  }

  try {
    const updated = await updatePageWebhookUrl(
      session.user.id,
      connectionId,
      formData.get("webhookUrl")
    )

    if (!updated) return { error: "No encontramos esa página." }

    log({
      entrypoint: "action",
      action: "webhook_url_save",
      outcome: "ok",
      ...accountFields(updated),
      // Nunca la URL: la controla el cliente y las de n8n suelen llevar un
      // token en el path. `connectionId` alcanza para saber cuál es.
    })

    if (posthog) {
      posthog.capture({
        distinctId: session.user.id,
        event: "webhook url saved",
        properties: {
          connection_id: connectionId,
          page_id: updated.metaPageId,
        },
      })
      await posthog.flush()
    }

    revalidatePath("/connections")
    return { message: "Webhook actualizado." }
  } catch (error) {
    // `normalizeWebhookUrl` (lib/pages/webhook-url.ts) ya devuelve su mensaje en
    // español y solo lo consume esta pantalla, así que se propaga tal cual:
    // distingue «tiene que ser https» de «no es una URL válida».
    if (error instanceof InvalidWebhookUrlError) {
      return { error: error.message }
    }
    throw error
  }
}

export async function disconnectPageAction(
  _state: ConnectionActionState,
  formData: FormData
): Promise<ConnectionActionState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No has iniciado sesión." }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: "Página inválida." }
  }

  let pageToUnsubscribe: Awaited<
    ReturnType<typeof getActivePageWithTokenByConnectionId>
  > = null
  try {
    pageToUnsubscribe = await getActivePageWithTokenByConnectionId(
      session.user.id,
      connectionId
    )
  } catch (error) {
    // Si esto falla, la baja de la suscripción no se puede intentar y la cuenta
    // queda recibiendo eventos de una conexión que el usuario ya cerró.
    log({
      entrypoint: "action",
      action: "webhook_unsubscribe",
      outcome: "failed",
      reason: "internal_error",
      tenantId: session.user.id,
      connectionId,
      errorMessage: describeError(error),
    })
  }

  const disconnected = await disconnectPage(session.user.id, connectionId)
  if (!disconnected) return { error: "No encontramos esa página." }

  log({
    entrypoint: "action",
    action: "account_disconnect",
    outcome: "ok",
    ...accountFields(disconnected),
  })

  if (posthog) {
    posthog.capture({
      distinctId: session.user.id,
      event: "page disconnected",
      properties: {
        connection_id: connectionId,
        page_id: disconnected.metaPageId,
        page_name: disconnected.name,
      },
    })
    await posthog.flush()
  }

  if (pageToUnsubscribe) {
    try {
      await unsubscribeChannelWebhook({
        channel: pageToUnsubscribe.page.channel,
        metaPageId: pageToUnsubscribe.page.metaPageId,
        accessToken: pageToUnsubscribe.pageAccessToken,
      })
    } catch (error) {
      // El bug latente que la etapa 2 encontró: con una cuenta de Instagram,
      // llamar al despachador equivocado da un 400 y no un error claro, y la
      // cuenta sigue recibiendo eventos. Ahora al menos queda registrado.
      log({
        entrypoint: "action",
        action: "webhook_unsubscribe",
        outcome: "failed",
        reason: "unsubscribe_failed",
        ...accountFields(pageToUnsubscribe.page),
        errorMessage: describeError(error),
      })
    }
  }

  revalidatePath("/connections")
  return { message: "Página desconectada. El historial se conserva." }
}
