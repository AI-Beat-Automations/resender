"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/auth"
import {
  disconnectPage,
  getActivePageWithTokenByConnectionId,
  getGeneratedWhatsappPin,
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

export type RevealWhatsappPinState = {
  error?: string
  // El PIN en claro. Solo existe en la respuesta de **esta** acción: no está en
  // el HTML de la pantalla ni en el payload de las tarjetas.
  pin?: string
}

// Devuelve el PIN de verificación en dos pasos que **generamos nosotros** para
// un número de WhatsApp de este tenant.
//
// Es una acción y no un dato de la pantalla a propósito. El PIN es una
// credencial del número del cliente que custodiamos porque Meta no la vuelve a
// mostrar (migración 0016): si viajara en el render de Conexiones estaría en el
// payload RSC de cada visita —y en la caché del navegador, y en cualquier
// captura de pantalla de soporte— aunque nadie lo estuviera mirando. Acá se
// descifra en el servidor, viaja una vez, y por petición explícita.
//
// El log deja constancia de la lectura **sin el PIN**: quién y cuándo pidió una
// credencial es justo lo que hay que poder auditar, y el valor es justo lo que
// no.
export async function revealWhatsappPinAction(
  _state: RevealWhatsappPinState,
  formData: FormData
): Promise<RevealWhatsappPinState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No has iniciado sesión." }

  const connectionId = formData.get("connectionId")
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: "Número inválido." }
  }

  try {
    // La consulta filtra por tenant y por «lo generamos nosotros»: un número de
    // otra cuenta, o uno cuyo PIN aportó el propio cliente, devuelven null y
    // acá son indistinguibles a propósito.
    const pin = await getGeneratedWhatsappPin(session.user.id, connectionId)
    if (!pin) {
      return {
        error:
          "No tenemos un PIN guardado para este número. Si lo activaste tú, el PIN es el que elegiste en WhatsApp Manager.",
      }
    }

    log({
      entrypoint: "action",
      action: "token_decrypt",
      outcome: "ok",
      channel: "whatsapp",
      tenantId: session.user.id,
      connectionId,
    })

    return { pin }
  } catch (error) {
    log({
      entrypoint: "action",
      action: "token_decrypt",
      outcome: "failed",
      reason: "internal_error",
      channel: "whatsapp",
      tenantId: session.user.id,
      connectionId,
      errorMessage: describeError(error),
    })
    return {
      error:
        "No pudimos leer el PIN ahora mismo. Vuelve a intentarlo; si se repite, escríbenos a info@resender.dev.",
    }
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
        // Null en Messenger e Instagram; en WhatsApp es el nodo del que cuelga
        // la suscripción, y sin él el despachador se niega a llamar a Meta en
        // vez de mandar el `phone_number_id` al endpoint equivocado.
        wabaId: pageToUnsubscribe.page.wabaId,
        // La fila ya está en `disconnected` en este punto —`disconnectPage`
        // corrió arriba—, así que la cuenta de números activos del WABA ya no
        // la incluye. Se excluye igual para no depender de ese orden: si alguien
        // mueve la desuscripción antes de la baja, el despachador seguiría
        // preguntando «¿queda alguno **además de este**?».
        excludeConnectionIds: [connectionId],
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
