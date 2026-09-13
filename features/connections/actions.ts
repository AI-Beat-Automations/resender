"use server"

import { revalidatePath } from "next/cache"

import {
  describeActorDenial,
  requireActor,
  requireOwner,
} from "@/lib/auth/actor"
import { getAppDict } from "@/lib/i18n/app-dict"
import {
  disconnectPage,
  getActivePageWithTokenByConnectionId,
  ensureWebhookSigningSecret,
  InvalidWebhookUrlError,
  rotateWebhookSigningSecret,
  updatePageWebhookUrl,
} from "@/lib/pages/page-registry"
import { scopeOf } from "@/lib/pages/connection-scope"
import { unsubscribeChannelWebhook } from "@/lib/pages/channel-webhook"
import { accountFields, describeError, log } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

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
  // El webhook es la integración de la agencia con su bot: la persona de un
  // cliente de agencia no lo ve ni lo toca (ADR 0020). Se chequea acá y no solo
  // en la tarjeta porque la acción se puede invocar por POST directo.
  const gate = await requireOwner()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }
  const { actor } = gate

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
  const gate = await requireActor()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }
  const { actor } = gate
  // Desconectar es de los dos roles, pero dentro del alcance: la persona de un
  // cliente de agencia solo desconecta las de su cliente (ADR 0020).
  const scope = scopeOf(actor)

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: t.actions.invalidPage }
  }

  let pageToUnsubscribe: Awaited<
    ReturnType<typeof getActivePageWithTokenByConnectionId>
  > = null
  try {
    pageToUnsubscribe = await getActivePageWithTokenByConnectionId(
      scope,
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
      tenantId: actor.tenantId,
      connectionId,
      errorMessage: describeError(error),
    })
  }

  const disconnected = await disconnectPage(scope, connectionId)
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
  // Mismo criterio que la `webhookUrl`: el secreto es de la integración de la
  // agencia (ADR 0020).
  const gate = await requireOwner()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }
  const { actor } = gate

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
