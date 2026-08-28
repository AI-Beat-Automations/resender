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

// El envío de plantilla entra en la lista en vez de reusar `outbound_send`, y
// es una decisión y no una omisión: son dos rutas con reglas distintas —la
// plantilla existe justamente para saltar la ventana de 24 h— y una acción
// propia es lo que deja preguntar «cuántos envíos de plantilla se rechazaron»
// con un filtro por `action`, en vez de reconstruirlo restando `reason` sobre
// un `outbound_send` que mezcla las dos. El helper sí es el mismo porque el
// patrón es el mismo: una línea terminal por request, con el código de Meta ya
// traducido.
type OutboundAction = Extract<
  LogAction,
  "outbound_send" | "template_send" | "comment_reply" | "comment_private_reply"
>

type Extra = {
  subjectId?: string
  providerId?: string
  contactId?: string
  textLength?: number
  // Identidad de la [Plantilla] enviada (ADR 0014). **Los `components` no
  // entran acá ni en ningún otro campo**: son datos del cliente final y valen
  // lo mismo que el texto del mensaje, que este módulo tampoco escribe.
  templateName?: string
  templateLanguage?: string
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
