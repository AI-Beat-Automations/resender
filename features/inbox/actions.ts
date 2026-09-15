"use server"

import { revalidatePath } from "next/cache"

import type { ForwardingPauseState } from "@/features/connections/actions"
import { getSession } from "@/lib/auth/session"
import { getAppDict } from "@/lib/i18n/app-dict"
import { setConversationForwardingPaused as persistConversationPause } from "@/lib/messages/message-log"
import { log } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

// Primera acción del slice `inbox`: hasta acá la pantalla era de solo lectura
// (ADR 0005). Pausar una conversación no la vuelve escribible —las respuestas
// siguen saliendo por la API externa—; solo decide si sus entrantes se
// reenvían o no (ADR 0020).
//
// La firma es `(conversationId, paused)` y no `FormData` para poder pasarla al
// `Switch` ya ligada al id desde el server component (`action.bind`).
export async function setConversationForwardingPaused(
  conversationId: string,
  paused: boolean
): Promise<ForwardingPauseState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }
  if (typeof conversationId !== "string" || !conversationId) {
    return { error: t.actions.conversationNotFound }
  }

  // El `tenant_id` va en el `where`: un id ajeno no existe para esta sesión y
  // devuelve el mismo «no encontramos» que uno inventado.
  const updated = await persistConversationPause(
    session.user.id,
    conversationId,
    paused === true
  )
  if (!updated) return { error: t.actions.conversationNotFound }

  log({
    entrypoint: "action",
    action: updated.pausedAt ? "forwarding_pause" : "forwarding_resume",
    outcome: "ok",
    tenantId: session.user.id,
    connectionId: updated.connectedPageId,
    subject: "message",
    contactId: updated.contactId,
  })

  if (posthog) {
    posthog.capture({
      distinctId: session.user.id,
      event: updated.pausedAt
        ? "conversation forwarding paused"
        : "conversation forwarding resumed",
      properties: {
        conversation_id: conversationId,
        connection_id: updated.connectedPageId,
      },
    })
    await posthog.flush()
  }

  revalidatePath("/inbox")
  return { pausedAt: updated.pausedAt?.toISOString() ?? null }
}
