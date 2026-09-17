"use server"

import { revalidatePath } from "next/cache"

import { getAppDict } from "@/lib/i18n/app-dict"
import { resolveActionActor } from "@/lib/clients/action-actor"
import {
  disconnectPage,
  getActivePageWithTokenByConnectionId,
  ensureWebhookSigningSecret,
  InvalidWebhookUrlError,
  rotateWebhookSigningSecret,
  setPageForwardingPaused,
  updatePageWebhookUrl,
} from "@/lib/pages/page-registry"
import { unsubscribeChannelWebhook } from "@/lib/pages/channel-webhook"
import { accountFields, describeError, log } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

// Resultado de pausar o reanudar el reenvío. `pausedAt` en ISO y no `Date`:
// cruza al cliente, y el `Switch` solo necesita saber si hay fecha.
export type ForwardingPauseState =
  | { pausedAt: string | null; error?: undefined }
  | { error: string; pausedAt?: undefined }

export type ConnectionActionState = {
  error?: string
  message?: string
  // El secreto de firma en claro, y **solo** en la respuesta de la acción que lo
  // generó. No se guarda en estado de servidor ni vuelve a leerse: en la base
  // está cifrado y no hay forma de recuperarlo, solo de rotarlo otra vez.
  revealedSecret?: string
}

export async function saveWebhookUrlAction(
  _state: ConnectionActionState,
  formData: FormData
): Promise<ConnectionActionState> {
  const t = await getAppDict()
  const who = await resolveActionActor(t)
  if (!who.ok) return { error: who.error }
  const { actor } = who
  // El webhook es del padre: la tarjeta del cliente no lo dibuja, y por POST
  // directo tampoco se acepta.
  if (actor.clientAccountId !== null) return { error: t.actions.pageNotFound }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: t.actions.invalidPage }
  }

  try {
    const updated = await updatePageWebhookUrl(
      actor.tenantId,
      connectionId,
      formData.get("webhookUrl")
    )

    if (!updated) return { error: t.actions.pageNotFound }

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
        distinctId: actor.userId,
        event: "webhook url saved",
        properties: {
          connection_id: connectionId,
          page_id: updated.metaPageId,
        },
      })
      await posthog.flush()
    }

    // Una conexión que estrena `webhookUrl` estrena secreto: así el primer
    // evento ya sale firmado sin que el usuario tenga que enterarse de que la
    // firma existe. Si ya tenía uno, no se toca — rotarlo al guardar la URL
    // invalidaría el que el receptor tiene configurado.
    const secret = updated.webhookUrl
      ? await ensureWebhookSigningSecret(actor.tenantId, connectionId)
      : null

    revalidatePath("/connections")
    return secret
      ? {
          message: t.actions.webhookUpdatedWithSecret,
          revealedSecret: secret,
        }
      : { message: t.actions.webhookUpdated }
  } catch (error) {
    // `normalizeWebhookUrl` devuelve un código y no un mensaje: el texto se
    // resuelve acá, que es donde hay idioma. Sigue distinguiendo «tiene que ser
    // https» de «no es una URL válida», que es la mitad útil del error.
    if (error instanceof InvalidWebhookUrlError) {
      return {
        error:
          error.code === "not_https"
            ? t.actions.webhookUrlNotHttps
            : t.actions.webhookUrlInvalid,
      }
    }
    throw error
  }
}

export async function disconnectPageAction(
  _state: ConnectionActionState,
  formData: FormData
): Promise<ConnectionActionState> {
  const t = await getAppDict()
  const who = await resolveActionActor(t)
  if (!who.ok) return { error: who.error }
  const { actor } = who

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: t.actions.invalidPage }
  }

  let pageToUnsubscribe: Awaited<
    ReturnType<typeof getActivePageWithTokenByConnectionId>
  > = null
  try {
    pageToUnsubscribe = await getActivePageWithTokenByConnectionId(
      actor.tenantId,
      connectionId,
      actor.clientAccountId
    )
  } catch (error) {
    // Si esto falla, la baja de la suscripción no se puede intentar y la cuenta
    // queda recibiendo eventos de una conexión que el usuario ya cerró.
    log({
      entrypoint: "action",
      action: "webhook_unsubscribe",
      outcome: "failed",
      reason: "internal_error",
      tenantId: actor.tenantId,
      connectionId,
      errorMessage: describeError(error),
    })
  }

  // Con el alcance del cliente: una conexión del padre o de otro cliente no
  // se encuentra, y el mensaje es el mismo que para un id inexistente.
  const disconnected = await disconnectPage(
    actor.tenantId,
    connectionId,
    actor.clientAccountId
  )
  if (!disconnected) return { error: t.actions.pageNotFound }

  log({
    entrypoint: "action",
    action: "account_disconnect",
    outcome: "ok",
    ...accountFields(disconnected),
  })

  if (posthog) {
    posthog.capture({
      distinctId: actor.userId,
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
  return { message: t.actions.disconnected }
}

// Rotar es la única forma de volver a ver un secreto, y por eso invalida el
// anterior: el push firmado con el nuevo deja de validar contra el que el
// receptor tenía. Es una acción destructiva y la UI lo dice antes.
export async function rotateWebhookSecretAction(
  _state: ConnectionActionState,
  formData: FormData
): Promise<ConnectionActionState> {
  const t = await getAppDict()
  const who = await resolveActionActor(t)
  if (!who.ok) return { error: who.error }
  const { actor } = who
  // Como el webhook: el secreto de firma es del padre.
  if (actor.clientAccountId !== null) return { error: t.actions.pageNotFound }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: t.actions.invalidPage }
  }

  const secret = await rotateWebhookSigningSecret(actor.tenantId, connectionId)
  if (!secret) return { error: t.actions.pageNotFound }

  log({
    entrypoint: "action",
    action: "webhook_secret_rotate",
    outcome: "ok",
    tenantId: actor.tenantId,
    connectionId,
    // El secreto no se loguea, obviamente. Que la línea exista es lo que
    // permite responder «¿cuándo dejó de validar mi firma?» sin adivinar.
  })

  revalidatePath("/connections")
  return {
    message: t.actions.secretRotated,
    revealedSecret: secret,
  }
}

// Pausa o reanuda el reenvío al webhook de la conexión entera (ADR 0020). No
// es un `FormData`: el disparador es un `Switch`, no un formulario, y el
// componente lo llama dentro de una transición con el valor nuevo.
//
// Sin confirmación previa: es reversible al instante y no destruye nada. Lo que
// llegue mientras está pausada se guarda y se cuenta igual; solo no sale.
export async function setConnectionForwardingPaused(
  connectionId: string,
  paused: boolean
): Promise<ForwardingPauseState> {
  const t = await getAppDict()
  const who = await resolveActionActor(t)
  if (!who.ok) return { error: who.error }
  const { actor } = who
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: t.actions.invalidPage }
  }

  // Con el alcance del cliente: solo sus propias conexiones.
  const updated = await setPageForwardingPaused(
    actor.tenantId,
    connectionId,
    paused === true,
    actor.clientAccountId
  )
  if (!updated) return { error: t.actions.pageNotFound }

  log({
    entrypoint: "action",
    action: updated.pausedAt ? "forwarding_pause" : "forwarding_resume",
    outcome: "ok",
    ...accountFields(updated),
  })

  if (posthog) {
    posthog.capture({
      distinctId: actor.userId,
      event: updated.pausedAt
        ? "connection forwarding paused"
        : "connection forwarding resumed",
      properties: {
        connection_id: connectionId,
        page_id: updated.metaPageId,
        channel: updated.channel,
      },
    })
    await posthog.flush()
  }

  revalidatePath("/connections")
  return { pausedAt: updated.pausedAt?.toISOString() ?? null }
}
