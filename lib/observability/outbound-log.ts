import crypto from "crypto"

import type { PageChannel } from "@/lib/pages/page-registry"

import { accountFields, log, type LogAction, type LogReason } from "./logger"

// Las rutas de salida tienen entre ocho y diez returns tempranos cada una, y
// todos eran mudos. Escribir el objeto de log entero en cada uno duplicaría el
// gate: la condición diría una cosa y la línea otra el día que alguien cambie
// una sola de las dos.
//
// Este helper acumula el contexto —que se completa a medida que la ruta
// resuelve la cuenta— y deja cada gate en una línea que **devuelve la misma
// respuesta que devolvía antes**, así el log no puede quedar desfasado del
// control de flujo.

type OutboundAction = Extract<
  LogAction,
  "outbound_send" | "comment_reply" | "comment_private_reply"
>

type Extra = {
  subjectId?: string
  providerId?: string
  contactId?: string
  textLength?: number
  status?: number
  durationMs?: number
  errorCode?: string | number
  errorSubcode?: number
  errorMessage?: string
}

// Acepta un `x-request-id` del cliente, con el mismo formato que valida el
// worker `api`. Es lo que convierte un ticket de soporte en un solo filtro; si
// no viene, se genera para que la request igual sea reconstruible.
export function resolveRequestId(supplied: string | null) {
  return supplied && /^[\w.:/-]{1,128}$/u.test(supplied)
    ? supplied
    : crypto.randomUUID()
}

export function outboundLogger(base: {
  action: OutboundAction
  channel: PageChannel
  requestId: string
  subject: "message" | "comment"
}) {
  let fields: Record<string, unknown> = {
    entrypoint: "route" as const,
    action: base.action,
    channel: base.channel,
    requestId: base.requestId,
    subject: base.subject,
  }

  return {
    // Se llama a medida que la ruta va sabiendo de quién es la request: primero
    // el tenant de la API key, después la cuenta conectada.
    setTenant(tenantId: string) {
      fields.tenantId = tenantId
    },
    setAccount(page: Parameters<typeof accountFields>[0]) {
      fields = { ...fields, ...accountFields(page) }
    },
    // Devuelve la respuesta que le pasan, para que el gate quede en una línea y
    // no se pueda loguear un descarte y contestar otra cosa.
    drop(reason: LogReason, response: Response, extra: Extra = {}) {
      log({
        ...fields,
        outcome: "dropped",
        reason,
        status: response.status,
        ...extra,
      } as Parameters<typeof log>[0])
      return response
    },
    duplicate(response: Response, extra: Extra = {}) {
      log({
        ...fields,
        outcome: "duplicate",
        reason: "idempotent_replay",
        status: response.status,
        ...extra,
      } as Parameters<typeof log>[0])
      return response
    },
    ok(extra: Extra = {}) {
      log({ ...fields, outcome: "ok", ...extra } as Parameters<typeof log>[0])
    },
    failed(reason: LogReason, extra: Extra = {}) {
      log({ ...fields, outcome: "failed", reason, ...extra } as Parameters<
        typeof log
      >[0])
    },
  }
}
