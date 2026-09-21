// La fila `bot → Resender` de la sección Logs: una por request a la API de
// salida, con lo que el bot mandó y lo que le contestamos.
//
// Es un envoltorio de la ruta y no líneas sueltas dentro de ella porque cada
// `/send` tiene entre ocho y diez returns tempranos: envolver garantiza que la
// fila refleje **la respuesta que realmente salió**, sea cual sea el return. Lo
// que el envoltorio no puede saber desde afuera —de qué tenant y de qué cuenta
// es la request— se lo cuenta la ruta por el `capture`, que viaja dentro del
// `outboundLogger` que ya se llamaba en esos mismos puntos.
//
// Una request sin tenant resuelto (401 de API key) no se guarda: no hay a quién
// mostrársela, igual que un webhook de Meta sin cuenta.
//
// La escritura va en `after()`, después de responderle al bot, y no lanza.

import { after, type NextRequest } from "next/server"

import type { PageChannel } from "@/lib/pages/page-registry"

import { logApiRequest, type LogAccount } from "./request-log"

export type ApiLogCapture = {
  /** El mismo id que la ruta usa en Workers Logs, generado o del cliente. */
  setRequestId(requestId: string): void
  setTenant(tenantId: string): void
  setAccount(account: LogAccount): void
  setSubject(subject: {
    contactId?: string
    providerId?: string
  }): void
}

type ApiLogMeta = {
  channel: PageChannel
  /** send | comment_reply | private_reply */
  eventType: string
  endpoint: string
}

export function withApiRequestLog(
  meta: ApiLogMeta,
  handler: (request: NextRequest, capture: ApiLogCapture) => Promise<Response>
) {
  return async function POST(request: NextRequest): Promise<Response> {
    const startedAt = Date.now()
    const state: {
      requestId: string | null
      tenantId: string | null
      account: LogAccount | null
      contactId: string | null
      providerId: string | null
    } = {
      requestId: null,
      tenantId: null,
      account: null,
      contactId: null,
      providerId: null,
    }
    const capture: ApiLogCapture = {
      setRequestId: (requestId) => {
        state.requestId = requestId
      },
      setTenant: (tenantId) => {
        state.tenantId = tenantId
      },
      setAccount: (account) => {
        state.account = account
      },
      setSubject: (subject) => {
        if (subject.contactId) state.contactId = subject.contactId
        if (subject.providerId) state.providerId = subject.providerId
      },
    }

    // El clon se lee antes de que la ruta consuma el body; si falla, la fila
    // sale sin request y la ruta ni se entera.
    const requestBody = request
      .clone()
      .text()
      .catch(() => null)

    const response = await handler(request, capture)

    const tenantId = state.tenantId
    if (!tenantId) return response

    const durationMs = Date.now() - startedAt
    const responseClone = response.clone()
    const write = async () => {
      const [requestText, responseText] = await Promise.all([
        requestBody,
        responseClone.text().catch(() => null),
      ])
      const parsed = describeApiResponse(responseText)
      await logApiRequest({
        tenantId,
        channel: meta.channel,
        eventType: meta.eventType,
        method: request.method,
        endpoint: meta.endpoint,
        httpStatus: response.status,
        durationMs,
        requestId: state.requestId,
        account: state.account,
        messageId: parsed.messageId,
        instagramCommentId: parsed.commentId,
        conversationId: parsed.conversationId,
        providerMessageId: state.providerId ?? parsed.providerId,
        contactId: state.contactId,
        errorCode: response.status >= 400 ? parsed.errorCode : null,
        errorMessage: response.status >= 400 ? parsed.errorMessage : null,
        requestBody: requestText,
        responseBody: responseText,
      })
    }
    try {
      after(write)
    } catch {
      // Fuera del alcance de una request (tests): promesa suelta, que no lanza.
      void write()
    }

    return response
  }
}

type ApiResponseFields = {
  messageId: string | null
  commentId: string | null
  conversationId: string | null
  providerId: string | null
  errorCode: string | null
  errorMessage: string | null
}

/**
 * Lo que la fila necesita de la respuesta que le dimos al bot. El error de Meta
 * ya viaja ahí adentro (`meta.error`), así que se lee de la respuesta y no de
 * la llamada a Graph: la fila muestra lo que el bot vio, no nuestros internos.
 * Puro.
 */
export function describeApiResponse(text: string | null): ApiResponseFields {
  const empty: ApiResponseFields = {
    messageId: null,
    commentId: null,
    conversationId: null,
    providerId: null,
    errorCode: null,
    errorMessage: null,
  }
  if (!text) return empty
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return empty
  }
  const root = asRecord(json)
  if (!root) return empty
  const resender = asRecord(root.resender)
  const meta = asRecord(root.meta)
  const metaError = asRecord(meta?.error)

  const metaCode = metaError?.code
  const metaSubcode = metaError?.error_subcode
  const metaMessage = asString(metaError?.message)
  const ownError = asString(root.error) ?? asString(root.message)

  return {
    messageId: asString(resender?.messageId),
    commentId: asString(resender?.commentId),
    conversationId: asString(resender?.conversationId),
    providerId:
      asString(meta?.message_id) ??
      asString(asRecord(Array.isArray(meta?.messages) ? meta.messages[0] : null)?.id) ??
      asString(resender?.igCommentId),
    errorCode:
      metaCode !== undefined && metaCode !== null
        ? `meta:${String(metaCode)}${
            metaSubcode !== undefined && metaSubcode !== null
              ? `/${String(metaSubcode)}`
              : ""
          }`
        : asString(root.code),
    // Nuestro motivo traducido primero; el texto crudo de Meta lo acompaña
    // cuando agrega algo.
    errorMessage:
      ownError && metaMessage && ownError !== metaMessage
        ? `${ownError} — Meta: ${metaMessage}`
        : (ownError ?? metaMessage),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}
