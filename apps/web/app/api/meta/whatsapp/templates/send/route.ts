import { type NextRequest } from "next/server"

import { incrementUsage } from "@/lib/billing/usage-counter"
import {
  getConversationById,
  getOutboundMessageByIdempotencyKey,
  insertOutboundMessage,
  upsertConversation,
  type MessageRecord,
} from "@/lib/messages/message-log"
import { describeError, log } from "@/lib/observability/logger"
import {
  outboundLogger,
  resolveRequestId,
} from "@/lib/observability/outbound-log"
import {
  extractWhatsappMessageId,
  isWhatsappExpiredTokenError,
  sendWhatsappOutboundMessage,
  type WhatsappOutboundContent,
} from "@/lib/outbound/whatsapp-send"
import {
  idempotentReplayResponse,
  isUniqueViolation,
  runWhatsappSendGates,
} from "@/lib/outbound/whatsapp-send-gates"
import { parseWhatsappTemplateSendInput } from "@/lib/outbound/whatsapp-template-send-request"
import {
  getActivePageWithTokenForTenant,
  markPageTokenInvalid,
} from "@/lib/pages/page-registry"
import { posthog } from "@/lib/posthog"
import { decideWhatsappTemplateSend } from "@/lib/whatsapp-templates/template-gate"
import {
  getWhatsappTemplate,
  type WhatsappTemplateRecord,
} from "@/lib/whatsapp-templates/template-registry"

// Envía una [Plantilla] de WhatsApp: el único mensaje que WhatsApp acepta con
// la [Ventana de atención] cerrada, y por lo tanto la única forma de que el
// negocio escriba primero (ADR 0014).
//
// Body: `{ pageId, recipientId, conversationId?, template: { name, language,
// components? } }`. El destino es idéntico al de `/whatsapp/send` —`pageId` es
// el `phone_number_id`— y lo único nuevo es el `template`.
//
// **Por qué es una ruta aparte y no una rama de `/whatsapp/send`.** El body de
// aquella lo parsea `parseOutboundSendInput`, que es **neutral de canal** y lo
// comparten Messenger, Instagram y WhatsApp. Un XOR de tres ramas en un parser
// que dos canales no pueden usar es costo permanente para los tres a cambio de
// ahorrar una ruta. Lo que sí se comparte —y es lo que hace que esta ruta no
// sea una segunda copia que diverge— son los ocho gates de auth, facturación e
// idempotencia, que viven en `lib/outbound/whatsapp-send-gates.ts`. Acá abajo
// no hay ni una línea de auth repetida: hay lo que esta ruta hace distinto.
//
// **La ventana de 24 h no se aplica, y ésa es la decisión más importante de
// este archivo.** No es un olvido y no hay que "arreglarlo": la plantilla
// existe exactamente para saltar esa regla. Un contacto que no escribió en 48 h
// —o que no escribió nunca— es alcanzable por acá y no lo es por
// `/whatsapp/send`, que sigue cortando con su 409. Si alguien agrega
// `isWindowOpen` a esta ruta, la entrega entera deja de tener sentido: el
// endpoint contestaría 409 justo en el único caso para el que fue construido.
// El test `sends to a contact who has not written in 48 hours` está escrito
// para que ese cambio no pase silencioso.
//
// **El gate del espejo falla abierto.** Es el único gate del envío que lo hace,
// y contrasta a propósito con los ocho de arriba, que fallan cerrados porque
// ahí la ausencia de dato significa «no tiene derecho». Acá significa otra
// cosa: `whatsapp_templates` es una copia de un catálogo del que Meta es dueño,
// y un hueco es un estado legítimo y frecuente —una plantilla creada en
// WhatsApp Manager después del último sync, o creada mientras el job paginaba—.
// Rechazar por ese hueco sería negarle al cliente un envío válido por una
// carencia nuestra, y encima una que él no puede arreglar. Lo que sí rechaza es
// la fila **presente** y no aprobada: eso no es un hueco sino una afirmación de
// Meta, y ahorrarnos la llamada convierte un 132001 remoto y tardío en un 409
// nuestro inmediato que nombra el estado. La decisión vive entera y pura en
// `lib/whatsapp-templates/template-gate.ts`.
//
// La respuesta —en éxito y cuando Meta rechaza— tiene **la misma forma** que la
// de `/whatsapp/send`, sobre `resender` incluido: para el que integra esto es
// un envío más, y que el sobre difiera lo obligaría a escribir dos lectores
// para la misma respuesta.
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"))
  // `template_send` y no `outbound_send`: son dos rutas con reglas distintas y
  // una acción propia es lo que deja preguntar «cuántos envíos de plantilla se
  // rechazaron» con un filtro, en vez de reconstruirlo restando `reason` sobre
  // una acción que mezcla las dos.
  const trace = outboundLogger({
    action: "template_send",
    channel: "whatsapp",
    subject: "message",
    requestId,
  })

  // ---- 1 a 8 -------------------------------------------------------------
  // API key, Idempotency-Key, permiso de canal, waitlist, suscripción,
  // entitlement, replay idempotente y el JSON del body. Idénticos y en el mismo
  // orden que en el envío libre: el rechazo ya viene armado y ya logueado.
  const gates = await runWhatsappSendGates({ request, trace })
  if (!gates.ok) return gates.response
  const { apiKey, idempotencyKey, periodStart, body } = gates

  // ---- 9. El body ---------------------------------------------------------
  // Parser propio, no el neutral. Y sin errores diferidos, a diferencia de
  // `/whatsapp/send`: allá el contenido se contesta después de la ventana para
  // que el 409 le gane al 400, y acá no hay ventana que pueda ganarle.
  const input = parseWhatsappTemplateSendInput(body)
  if (!input.ok) {
    return trace.drop(
      "invalid_request",
      Response.json({ code: input.code, error: input.error }, { status: 400 }),
      { errorCode: input.code }
    )
  }
  const { pageId, recipientId, conversationId, template } = input.value
  // Identidad de la plantilla, para toda línea de log de acá en adelante. **Los
  // `components` no entran nunca**: son datos del cliente final y valen lo mismo
  // que el texto de un mensaje, que este producto no escribe en logs.
  const templateFields = {
    templateName: template.name,
    templateLanguage: template.language,
  }

  // ---- 10. La cuenta conectada --------------------------------------------
  // El canal va explícito: `meta_page_id` es único por `(channel,
  // meta_page_id)` desde la 0013, así que buscar sin canal puede traer la fila
  // de otro.
  const connectedPage = await getActivePageWithTokenForTenant(
    apiKey.tenantId,
    pageId,
    "whatsapp"
  )
  if (!connectedPage) {
    return trace.drop(
      "page_not_connected",
      Response.json(
        { error: "WhatsApp number is not connected for this tenant" },
        { status: 404 }
      ),
      { ...templateFields, errorMessage: `phoneNumberId=${pageId}` }
    )
  }
  trace.setAccount(connectedPage.page)

  // ---- 11. La conversación ------------------------------------------------
  // Igual que en el envío libre, y por el mismo motivo: la fila de `messages`
  // necesita una conversación y el Inbox necesita que la plantilla aparezca en
  // el mismo hilo donde después va a contestar el contacto.
  let conversation = conversationId
    ? await getConversationById(apiKey.tenantId, conversationId)
    : null

  if (conversationId) {
    if (
      !conversation ||
      conversation.connectedPageId !== connectedPage.page.id ||
      conversation.contactId !== recipientId
    ) {
      return trace.drop(
        "invalid_request",
        Response.json(
          { error: "conversationId does not match pageId and recipientId" },
          { status: 400 }
        ),
        templateFields
      )
    }
  } else {
    // Sin `message`, así que el upsert no mueve `last_inbound_at`: un saliente
    // nuestro no abre la ventana, y una plantilla tampoco. Es el caso normal de
    // esta ruta —el contacto todavía no escribió nunca— y la fila que nace acá
    // es la misma que se va a reusar cuando conteste.
    conversation = await upsertConversation({
      tenantId: apiKey.tenantId,
      connectedPageId: connectedPage.page.id,
      contactId: recipientId,
      lastMessageAt: new Date(),
    })
  }

  if (!conversation) {
    return trace.drop(
      "invalid_request",
      Response.json({ error: "conversation not found" }, { status: 400 }),
      templateFields
    )
  }

  // ---- La ventana de atención de 24 h: NO SE APLICA -----------------------
  // Acá iría `isWindowOpen(conversation.lastInboundAt, ...)` si esta ruta fuera
  // una copia de `/whatsapp/send`. No está, y su ausencia es deliberada: la
  // [Plantilla] es el mensaje que WhatsApp acepta **precisamente** con la
  // ventana cerrada. Agregar el gate acá convertiría el endpoint en un 409
  // permanente para su caso de uso principal.
  //
  // Que se pueda escribir primero no significa que se pueda escribir cualquier
  // cosa: el freno no es local sino de Meta —sólo acepta plantillas aprobadas,
  // y baja la calidad del número si a la gente le molestan—. Un tope propio de
  // envíos a contactos que nunca contestaron se evaluó y se descartó en la ADR
  // 0014: un número inventado por nosotros estorbaría a un recordatorio de cita
  // legítimo antes de salvar a nadie.

  // ---- 12. El espejo de la plantilla --------------------------------------
  // La plantilla vive en la WABA y no en el número, así que se busca por
  // `waba_id` y el catálogo puede ser compartido con otro tenant. Sin WABA en
  // la fila —una anomalía de datos, no un estado normal— no hay espejo que
  // consultar, y la regla del módulo ya dice qué hacer cuando no sabemos: se
  // intenta y decide Meta.
  const wabaId = connectedPage.page.wabaId
  // **La lectura va en `try` porque el gate falla abierto, y un error de
  // lectura es un hueco más.** Sin el `try`, el único gate del envío cuyo
  // contrato es permitir ante la duda se convertía en el más duro de todos: una
  // caída de la base rechazaba con un 500 —y sin línea terminal— justo el envío
  // que el fail-open existe para dejar pasar. «No sabemos qué dice el espejo» y
  // «el espejo no la tiene» llevan a la misma decisión: se intenta y decide
  // Meta, que es quien de verdad puede rechazarla.
  let mirrored: WhatsappTemplateRecord | null = null
  if (wabaId) {
    try {
      mirrored = await getWhatsappTemplate({
        wabaId,
        name: template.name,
        language: template.language,
      })
    } catch (error) {
      // `template_send` y no `template_list`: esto no es un listado del
      // catálogo sino **un envío cuyo gate no se pudo consultar**, y ponerle la
      // acción del CRUD lo mezclaría en la bitácora con las altas, bajas y
      // listados de plantillas, que es justo la pregunta que la acción propia
      // existe para separar.
      //
      // Lo que la distingue de la línea terminal —que sigue siendo una sola, la
      // de más abajo— es el motivo: `template_mirror_unavailable` dice que
      // falló nuestra lectura del espejo, no el envío. Va en `failed` porque el
      // fallo es nuestro y no de Meta: sin esta línea, el fail-open se tragaría
      // en silencio una base caída.
      log({
        entrypoint: "route",
        action: "template_send",
        outcome: "failed",
        reason: "template_mirror_unavailable",
        requestId,
        tenantId: apiKey.tenantId,
        connectionId: connectedPage.page.id,
        channel: "whatsapp",
        wabaId,
        ...templateFields,
        errorMessage: describeError(error),
      })
    }
  }

  const decision = decideWhatsappTemplateSend(mirrored)
  if (!decision.allowed) {
    return trace.drop(
      "template_not_approved",
      Response.json(
        {
          error: "template_not_approved",
          // El estado **crudo**, el que Meta dijo de verdad y el que el cliente
          // ve en WhatsApp Manager. Publicar además el normalizado obligaría a
          // los clientes a elegir cuál mirar, y con un estado nuevo el
          // normalizado sería `unknown`, que no le sirve a nadie para actuar.
          templateStatus: decision.rawStatus,
          message: decision.message,
        },
        { status: 409 }
      ),
      { ...templateFields, errorCode: decision.status }
    )
  }

  // ---- 13. El envío a Cloud API -------------------------------------------
  // `components` va tal cual vino, sin mirar: no validamos el conteo de
  // parámetros (ADR 0014). Si no coincide, el que lo dice es Meta.
  const content: WhatsappOutboundContent = {
    reply: null,
    attachment: null,
    template,
  }

  const sentAt = new Date()
  const metaResult = await sendWhatsappOutboundMessage({
    accessToken: connectedPage.pageAccessToken,
    // En WhatsApp `meta_page_id` guarda el `phone_number_id`, que es el id del
    // path de Cloud API: el `pageId` público y el del envío son el mismo valor.
    phoneNumberId: connectedPage.page.metaPageId,
    to: recipientId,
    content,
  })
  const metaDurationMs = Date.now() - sentAt.getTime()

  if (!metaResult.ok && isWhatsappExpiredTokenError(metaResult.data)) {
    try {
      await markPageTokenInvalid({
        tenantId: apiKey.tenantId,
        connectionId: connectedPage.page.id,
        error:
          metaResult.error ??
          "Meta rejected the WhatsApp token. Reconnect the number in Resender.",
      })
    } catch (error) {
      log({
        entrypoint: "route",
        action: "token_invalidate",
        outcome: "failed",
        reason: "internal_error",
        requestId,
        tenantId: apiKey.tenantId,
        connectionId: connectedPage.page.id,
        channel: "whatsapp",
        accountId: connectedPage.page.metaPageId,
        errorMessage: describeError(error),
      })
    }
  }

  // El wamid de Cloud API, que es lo que después trae el callback de `statuses`
  // para decir si el mensaje se entregó. El extractor de Messenger devolvería
  // `null` siempre y la fila quedaría sin el id con el que la encuentran.
  const wamid = extractWhatsappMessageId(metaResult.data)

  let message: MessageRecord
  try {
    // Se persiste tanto si Meta lo aceptó como si lo rechazó: el fallo también
    // es historial, y es lo que el usuario necesita ver cuando pregunta por qué
    // su cliente no recibió nada.
    message = await insertOutboundMessage({
      tenantId: apiKey.tenantId,
      conversationId: conversation.id,
      connectedPageId: connectedPage.page.id,
      contactId: recipientId,
      // Vacío y no el cuerpo renderizado: el texto que le llegó al contacto lo
      // arma WhatsApp con la plantilla aprobada, que no tenemos —el espejo no
      // guarda contenido—. Inventar acá una reconstrucción sería guardar como
      // hecho algo que nunca vimos. El Inbox renderiza desde `templateMeta`.
      text: "",
      status: metaResult.ok ? "sent" : "failed",
      metaMessageId: wamid,
      idempotencyKey,
      // Una [Plantilla] **no** es un [Adjunto]: el `template` del catálogo de
      // adjuntos es la tarjeta con botones de Messenger y no tiene relación.
      attachment: null,
      // Lo de **este envío**, no lo de la plantilla: nombre, idioma y los
      // `components` que se mandaron. Es lo que le permite al Inbox mostrar qué
      // se le dijo al contacto aunque el espejo haya derivado o la plantilla se
      // haya editado después.
      templateMeta: template,
      // Lo mandó la API pública, no el negocio desde la WhatsApp Business App.
      origin: "resender_api",
      error: metaResult.reason ?? metaResult.error,
      providerResponse: metaResult.data,
      createdAt: sentAt,
    })
  } catch (error) {
    // Carrera de dos requests con la misma Idempotency-Key: el índice único
    // rechaza el segundo insert y devolvemos el mensaje ya almacenado.
    if (isUniqueViolation(error)) {
      const existing = await getOutboundMessageByIdempotencyKey(
        apiKey.tenantId,
        idempotencyKey
      )
      if (existing) {
        return trace.duplicate(idempotentReplayResponse(existing), {
          subjectId: existing.id,
        })
      }
    }
    trace.failed("internal_error", {
      ...templateFields,
      errorMessage: describeError(error),
    })
    throw error
  }

  // Una línea terminal por request, con el código de Meta ya traducido al
  // catálogo de WhatsApp.
  const traceFields = {
    subjectId: message.id,
    providerId: wamid ?? undefined,
    contactId: recipientId,
    ...templateFields,
    status: metaResult.status,
    durationMs: metaDurationMs,
  }
  if (metaResult.ok) {
    trace.ok(traceFields)
  } else {
    trace.failed("meta_rejected", {
      ...traceFields,
      errorMessage: metaResult.reason ?? metaResult.error ?? undefined,
    })
  }

  // Una plantilla consume 1 de cuota igual que cualquier otro saliente, y sólo
  // si Meta la aceptó ([Mensaje contabilizado]). Contabilizarla aparte sería
  // modelar un plan de precios que todavía no existe. Best-effort: un fallo del
  // contador no puede hacer fallar un mensaje que Meta ya entregó.
  if (metaResult.ok) {
    try {
      await incrementUsage(apiKey.tenantId, periodStart)
    } catch (error) {
      log({
        entrypoint: "route",
        action: "usage_increment",
        outcome: "failed",
        reason: "usage_counter_failed",
        requestId,
        tenantId: apiKey.tenantId,
        channel: "whatsapp",
        accountId: connectedPage.page.metaPageId,
        errorMessage: describeError(error),
      })
    }
  }

  if (posthog) {
    posthog.capture({
      distinctId: apiKey.tenantId,
      event: "message sent",
      properties: {
        message_id: message.id,
        conversation_id: conversation.id,
        page_id: pageId,
        channel: "whatsapp",
        status: message.status,
        meta_ok: metaResult.ok,
        // Sin nombre de plantilla: alcanza con saber que fue una plantilla para
        // medir adopción, y el nombre lo elige el cliente final.
        template: true,
      },
    })
    await posthog.flush()
  }

  return Response.json(
    {
      ...(metaResult.ok
        ? {}
        : {
            ...(metaResult.code ? { code: metaResult.code } : {}),
            error: metaResult.reason ?? metaResult.error,
          }),
      meta: metaResult.data,
      resender: {
        conversationId: conversation.id,
        messageId: message.id,
        status: message.status,
      },
    },
    { status: metaResult.status }
  )
}
