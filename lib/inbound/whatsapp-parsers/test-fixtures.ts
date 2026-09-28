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

// Los webhooks de la WABA (plantillas) no traen `value.metadata`: la plantilla
// es de la WABA, no de un número. El `time` es el de los ejemplos de Meta.
export const wabaWebhook = (field: string, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: WABA_ID,
      time: 1751247548,
      changes: [{ value, field }],
    },
  ],
})

// Los `value` de la referencia de webhooks de Meta, tal cual.
export const TEMPLATE_APPROVED = {
  event: "APPROVED",
  message_template_id: 1689556908129832,
  message_template_name: "order_confirmation",
  message_template_language: "en-US",
  reason: "NONE",
  message_template_category: "UTILITY",
}

export const TEMPLATE_REJECTED = {
  event: "REJECTED",
  message_template_id: 1689556908129835,
  message_template_name: "abandoned_cart",
  message_template_language: "en",
  reason: "INVALID_FORMAT",
  message_template_category: "MARKETING",
  rejection_info: {
    reason:
      "Your template has parameters placed next to each other without any text between them.",
    recommendation: "Separate parameters with descriptive text.",
  },
}

export const TEMPLATE_CATEGORY_CHANGED = {
  message_template_id: 278077987957091,
  message_template_name: "welcome_template",
  message_template_language: "en-US",
  previous_category: "UTILITY",
  new_category: "MARKETING",
}

export const TEMPLATE_CATEGORY_UPCOMING = {
  message_template_id: 278077987957091,
  message_template_name: "welcome_template",
  message_template_language: "en-US",
  new_category: "UTILITY",
  correct_category: "MARKETING",
  category_update_timestamp: 1746169200,
}

export const TEMPLATE_QUALITY = {
  previous_quality_score: "GREEN",
  new_quality_score: "YELLOW",
  message_template_id: 806312974732579,
  message_template_name: "welcome_template",
  message_template_language: "en-US",
}

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
