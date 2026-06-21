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

export type ConnectionActionState = {
  error?: string
  message?: string
}

export async function saveWebhookUrlAction(
  _state: ConnectionActionState,
  formData: FormData
): Promise<ConnectionActionState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No autenticado." }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: "Pagina invalida." }
  }

  try {
    const updated = await updatePageWebhookUrl(
      session.user.id,
      connectionId,
      formData.get("webhookUrl")
    )

    if (!updated) return { error: "Pagina no encontrada." }
    revalidatePath("/connections")
    return { message: "Webhook guardado." }
  } catch (error) {
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
  if (!session?.user?.id) return { error: "No autenticado." }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: "Pagina invalida." }
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
    console.error("meta webhook unsubscribe context failed", connectionId, error)
  }

  const disconnected = await disconnectPage(session.user.id, connectionId)
  if (!disconnected) return { error: "Pagina no encontrada." }

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
  return { message: "Pagina desconectada. El historial se conserva." }
}
