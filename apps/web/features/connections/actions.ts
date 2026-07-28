"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/auth"
import {
  disconnectPage,
  getActivePageWithTokenByConnectionId,
  InvalidWebhookUrlError,
  updatePageWebhookUrl,
} from "@/lib/pages/page-registry"
import { unsubscribeFromWebhook } from "@/lib/meta"
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
    console.error(
      "meta webhook unsubscribe context failed",
      connectionId,
      error
    )
  }

  const disconnected = await disconnectPage(session.user.id, connectionId)
  if (!disconnected) return { error: "No encontramos esa página." }

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
      await unsubscribeFromWebhook(
        pageToUnsubscribe.page.metaPageId,
        pageToUnsubscribe.pageAccessToken
      )
    } catch (error) {
      console.error(
        "meta webhook unsubscribe failed",
        pageToUnsubscribe.page.metaPageId,
        error
      )
    }
  }

  revalidatePath("/connections")
  return { message: "Página desconectada. El historial se conserva." }
}
