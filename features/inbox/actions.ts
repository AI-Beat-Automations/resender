"use server"

import { revalidatePath } from "next/cache"

import type { ForwardingPauseState } from "@/features/connections/actions"
import { resolveActionActor } from "@/lib/clients/action-actor"
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
  const who = await resolveActionActor(t)
  if (!who.ok) return { error: who.error }
  const { actor } = who
  if (typeof conversationId !== "string" || !conversationId) {
    return { error: t.actions.conversationNotFound }
  }

  // El `tenant_id` y el alcance del actor van en el `where` (issue #154): para
  // un cliente, una conversación de una conexión del padre o de otro cliente
  // no existe y devuelve el mismo «no encontramos» que un id inventado.
  const updated = await persistConversationPause(
    actor.tenantId,
    conversationId,
    paused === true,
    actor.clientAccountId
  )
  if (!updated) return { error: t.actions.conversationNotFound }

  log({
    entrypoint: "action",
    action: updated.pausedAt ? "forwarding_pause" : "forwarding_resume",
    outcome: "ok",
    tenantId: actor.tenantId,
    connectionId: updated.connectedPageId,
    subject: "message",
    contactId: updated.contactId,
  })

  if (posthog) {
    posthog.capture({
      distinctId: actor.userId,
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
