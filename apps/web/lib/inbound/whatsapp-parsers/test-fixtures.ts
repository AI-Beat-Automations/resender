import { expect } from "vitest"

import { extractWhatsappMessages } from "./batch"

// Fixtures compartidos por los tests de este directorio. **No es código de
// producción**: vive aquí y no en `test/` porque son los payloads literales de
// la documentación de Meta —mismos `wamid`, mismos `sha256`, mismos números—,
// no invenciones. Un parser probado contra payloads imaginados solo demuestra
// que coincide consigo mismo.

export const WABA_ID = "102290129340398"
export const PHONE_NUMBER_ID = "106540352242922"
export const BUSINESS_PHONE = "15550783881"
export const USER_PHONE = "16505551234"

// La URL de descarga que Meta empezó a incluir en noviembre de 2025 y que
// caduca a los cinco minutos. No debe sobrevivir a ningún parser.
export const TEMPORARY_MEDIA_URL =
  "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=133"

export const webhook = (field: string, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: WABA_ID,
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: BUSINESS_PHONE,
              phone_number_id: PHONE_NUMBER_ID,
            },
            ...value,
          },
          field,
        },
      ],
    },
  ],
})

export const message = (overrides: Record<string, unknown>) => ({
  from: USER_PHONE,
  id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
  timestamp: "1749416383",
  ...overrides,
})

export const inbound = (...messages: Array<Record<string, unknown>>) =>
  webhook("messages", {
    contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: USER_PHONE }],
    messages,
  })

export const only = (...messages: Array<Record<string, unknown>>) => {
  const events = extractWhatsappMessages(inbound(...messages))
  expect(events).toHaveLength(messages.length)
  return events[0]!
}

// --- Los tres campos de plantilla, de ámbito WABA -------------------------
//
// Sobre aparte del de arriba, y **sin `metadata`**, que es la diferencia que
// importa: ninguno de los tres payloads de la documentación trae
// `phone_number_id`, porque la plantilla vive en la cuenta y no en el número.
// Un fixture que se lo agregara para «que funcione» estaría probando un webhook
// que Meta no manda, y taparía justo el caso que rompía antes de la 0014.
//
// El `id` del `entry` coincide con `WABA_ID` sin retoques: los ejemplos de Meta
// usan literalmente `102290129340398`, el mismo de los payloads de mensajes.
export const templateWebhook = (
  field: string,
  value: Record<string, unknown>
) => ({
  entry: [
    {
      id: WABA_ID,
      time: 1751247548,
      changes: [{ value, field }],
    },
  ],
  object: "whatsapp_business_account",
})

// Aprobación de `order_confirmation`, literal de la referencia de
// `message_template_status_update`. `reason: "NONE"` es un valor real del
// catálogo de Meta y viene incluso en las aprobaciones.
export const TEMPLATE_STATUS_APPROVED = {
  event: "APPROVED",
  message_template_id: 1689556908129832,
  message_template_name: "order_confirmation",
  message_template_language: "en-US",
  reason: "NONE",
  message_template_category: "UTILITY",
}

// Rechazo de `abandoned_cart` con `rejection_info`, literal de la misma página.
// El bloque solo aparece cuando el motivo es `INVALID_FORMAT`.
export const TEMPLATE_STATUS_REJECTED = {
  event: "REJECTED",
  message_template_id: 1689556908129835,
  message_template_name: "abandoned_cart",
  message_template_language: "en",
  reason: "INVALID_FORMAT",
  message_template_category: "MARKETING",
  rejection_info: {
    reason:
      "Your template has parameters placed next to each other (like {{1}}{{2}}) without text or punctuation between them.",
    recommendation:
      "Separate parameters with descriptive text and ensure each parameter is clearly contextualized.",
  },
}

// Aviso de recategorización **inminente**, literal de la referencia de
// `template_category_update`. Ojo con la trampa: aquí `new_category` es la
// categoría que la plantilla tiene ahora y `correct_category` la que tendrá
// dentro de 24 h.
export const TEMPLATE_CATEGORY_IMPENDING = {
  message_template_id: 278077987957091,
  message_template_name: "welcome_template",
  message_template_language: "en-US",
  new_category: "UTILITY",
  correct_category: "MARKETING",
  category_update_timestamp: 1746169200,
}

// La misma plantilla cuando la recategorización ya ocurrió, literal de la misma
// página. Ahora `new_category` sí es la categoría estrenada.
export const TEMPLATE_CATEGORY_COMPLETED = {
  message_template_id: 278077987957091,
  message_template_name: "welcome_template",
  message_template_language: "en-US",
  previous_category: "UTILITY",
  new_category: "MARKETING",
}

// Caída de calidad de verde a amarillo, literal de la referencia de
// `message_template_quality_update`. La escala es GREEN/YELLOW/RED/UNKNOWN.
export const TEMPLATE_QUALITY_DROP = {
  previous_quality_score: "GREEN",
  new_quality_score: "YELLOW",
  message_template_id: 806312974732579,
  message_template_name: "welcome_template",
  message_template_language: "en-US",
}
