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
  if (!session?.user?.id) return { error: "Not authenticated." }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: "Invalid Page." }
  }

  try {
    const updated = await updatePageWebhookUrl(
      session.user.id,
      connectionId,
      formData.get("webhookUrl")
    )

    if (!updated) return { error: "Page not found." }

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
    return { message: "Webhook saved." }
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
  if (!session?.user?.id) return { error: "Not authenticated." }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: "Invalid Page." }
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
  if (!disconnected) return { error: "Page not found." }

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
  return { message: "Page disconnected. The history is kept." }
}
