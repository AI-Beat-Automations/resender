"use server"

import { revalidatePath } from "next/cache"

import { getSession } from "@/lib/auth/session"
import { getAppDict } from "@/lib/i18n/app-dict"
import {
  disconnectPage,
  getActivePageWithTokenByConnectionId,
  ensureWebhookSigningSecret,
  InvalidWebhookUrlError,
  rotateWebhookSigningSecret,
  updatePageWebhookUrl,
} from "@/lib/pages/page-registry"
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
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: t.actions.invalidPage }
  }

  try {
    const updated = await updatePageWebhookUrl(
      session.user.id,
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
        distinctId: session.user.id,
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
      ? await ensureWebhookSigningSecret(session.user.id, connectionId)
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
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: t.actions.invalidPage }
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
  if (!disconnected) return { error: t.actions.pageNotFound }

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
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: t.actions.invalidPage }
  }

  const secret = await rotateWebhookSigningSecret(session.user.id, connectionId)
  if (!secret) return { error: t.actions.pageNotFound }

  log({
    entrypoint: "action",
    action: "webhook_secret_rotate",
    outcome: "ok",
    tenantId: session.user.id,
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
