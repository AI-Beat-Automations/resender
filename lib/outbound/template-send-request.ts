import {
  parseSendTarget,
  type OutboundSendErrorCode,
  type SendTarget,
} from "./send-request"

// El body de `POST /api/meta/whatsapp/templates/send` (ADR 0024):
//
//   { conversationId } | { pageId, recipientId, conversationId? }
//   + { template: { name, language, components? } }
//
// El destino es el mismo de `/whatsapp/send` y lo valida el mismo
// `parseSendTarget`. El contenido va en un parser propio y no en
// `parseOutboundSendInput`: ese es neutral de canal y lo comparten los tres, y
// una plantilla solo existe en WhatsApp.
//
// `components` se valida lo justo —que sea un array— y se pasa tal cual a
// Meta. Contar parámetros acá sería adivinar la plantilla: un rechazo nuestro
// por error es peor que uno de Meta, porque contra el nuestro el cliente no
// puede hacer nada.

export type TemplateSendErrorCode =
  | "template_missing"
  | "template_name_missing"
  | "template_language_missing"
  | "template_components_invalid"

export type OutboundTemplate = {
  name: string
  language: string
  components?: unknown[]
}

export type TemplateSendInput = {
  target: SendTarget
  template: OutboundTemplate
}

export type TemplateSendInputResult =
  | { ok: true; value: TemplateSendInput }
  | {
      ok: false
      code: OutboundSendErrorCode | TemplateSendErrorCode | null
      error: string
    }

export function parseTemplateSendInput(body: unknown): TemplateSendInputResult {
  const target = parseSendTarget(body)
  if (!target.ok) return target

  const { template } = body as Record<string, unknown>

  if (!template || typeof template !== "object" || Array.isArray(template)) {
    return {
      ok: false,
      code: "template_missing",
      error: "missing template: send { name, language, components? }",
    }
  }

  const { name, language, components } = template as Record<string, unknown>

  if (typeof name !== "string" || name.trim().length === 0) {
    return {
      ok: false,
      code: "template_name_missing",
      error: "missing template.name",
    }
  }

  if (typeof language !== "string" || language.trim().length === 0) {
    return {
      ok: false,
      code: "template_language_missing",
      error: "missing template.language (for example en_US)",
    }
  }

  if (components !== undefined && !Array.isArray(components)) {
    return {
      ok: false,
      code: "template_components_invalid",
      error: "template.components must be an array",
    }
  }

  return {
    ok: true,
    value: {
      target: target.value,
      template: {
        name: name.trim(),
        language: language.trim(),
        ...(components !== undefined ? { components } : {}),
      },
    },
  }
}
