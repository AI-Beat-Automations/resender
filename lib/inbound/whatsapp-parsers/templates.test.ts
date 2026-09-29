import { describe, expect, it } from "vitest"

import { parseWhatsappWebhook } from "./index"
import {
  PHONE_NUMBER_ID,
  TEMPLATE_APPROVED,
  TEMPLATE_CATEGORY_CHANGED,
  TEMPLATE_CATEGORY_UPCOMING,
  TEMPLATE_QUALITY,
  TEMPLATE_REJECTED,
  WABA_ID,
  wabaWebhook,
} from "./test-fixtures"

// Los tres webhooks de plantillas de la WABA, contra los payloads de la
// referencia de Meta.

describe("message_template_status_update", () => {
  it("lee un cambio a APPROVED", () => {
    const batch = parseWhatsappWebhook(
      wabaWebhook("message_template_status_update", TEMPLATE_APPROVED)
    )

    expect(batch.templateStatuses).toEqual([
      {
        wabaId: WABA_ID,
        metaTemplateId: "1689556908129832",
        name: "order_confirmation",
        // `en-US` en el webhook, `en_US` en la copia que trae el sync.
        language: "en_US",
        timestamp: new Date(1751247548 * 1000),
        event: "APPROVED",
        status: "APPROVED",
        needsResync: false,
        category: "utility",
        // `NONE` no es un motivo.
        reason: null,
      },
    ])
    expect(batch.unhandledFields).toEqual([])
  })

  it("lee un REJECTED con su motivo", () => {
    const [event] = parseWhatsappWebhook(
      wabaWebhook("message_template_status_update", TEMPLATE_REJECTED)
    ).templateStatuses

    expect(event).toMatchObject({
      name: "abandoned_cart",
      language: "en",
      status: "REJECTED",
      category: "marketing",
      reason: "INVALID_FORMAT",
    })
  })

  it("toma el motivo de una pausa de other_info", () => {
    const [event] = parseWhatsappWebhook(
      wabaWebhook("message_template_status_update", {
        ...TEMPLATE_APPROVED,
        event: "PAUSED",
        reason: null,
        other_info: { title: "FIRST_PAUSE", description: "Pausada 3 horas" },
      })
    ).templateStatuses

    expect(event).toMatchObject({ status: "PAUSED", reason: "FIRST_PAUSE" })
  })

  // «Ya no está marcada ni deshabilitada y se puede volver a enviar».
  it("escribe REINSTATED como APPROVED", () => {
    const [event] = parseWhatsappWebhook(
      wabaWebhook("message_template_status_update", {
        ...TEMPLATE_APPROVED,
        event: "REINSTATED",
      })
    ).templateStatuses

    expect(event).toMatchObject({ event: "REINSTATED", status: "APPROVED" })
  })

  it.each(["FLAGGED", "LOCKED"])(
    "%s no es un estado: no toca la copia",
    (name) => {
      const [event] = parseWhatsappWebhook(
        wabaWebhook("message_template_status_update", {
          ...TEMPLATE_APPROVED,
          event: name,
        })
      ).templateStatuses

      expect(event).toMatchObject({ event: name, status: null })
      expect(event?.needsResync).toBe(false)
    }
  )

  // Vuelve «a su estado anterior», que el webhook no dice.
  it("UNARCHIVED pide volver a sincronizar", () => {
    const [event] = parseWhatsappWebhook(
      wabaWebhook("message_template_status_update", {
        ...TEMPLATE_APPROVED,
        event: "UNARCHIVED",
      })
    ).templateStatuses

    expect(event).toMatchObject({ status: null, needsResync: true })
  })

  it("descarta el cambio sin nombre, sin idioma o sin WABA", () => {
    const sinNombre = { ...TEMPLATE_APPROVED, message_template_name: undefined }
    const sinIdioma = {
      ...TEMPLATE_APPROVED,
      message_template_language: undefined,
    }

    expect(
      parseWhatsappWebhook(
        wabaWebhook("message_template_status_update", sinNombre)
      ).templateStatuses
    ).toEqual([])
    expect(
      parseWhatsappWebhook(
        wabaWebhook("message_template_status_update", sinIdioma)
      ).templateStatuses
    ).toEqual([])
    expect(
      parseWhatsappWebhook({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "message_template_status_update",
                value: TEMPLATE_APPROVED,
              },
            ],
          },
        ],
      }).templateStatuses
    ).toEqual([])
  })
})

describe("template_category_update", () => {
  it("lee un cambio de categoría ya hecho", () => {
    const batch = parseWhatsappWebhook(
      wabaWebhook("template_category_update", TEMPLATE_CATEGORY_CHANGED)
    )

    expect(batch.templateCategories).toEqual([
      expect.objectContaining({
        metaTemplateId: "278077987957091",
        name: "welcome_template",
        language: "en_US",
        category: "marketing",
        previousCategory: "UTILITY",
        upcomingCategory: null,
      }),
    ])
  })

  // `new_category` es la vigente también en el aviso: la copia se escribe con
  // ella y no con la que va a tener.
  it("en el aviso de 24 h la categoría vigente sigue siendo la de hoy", () => {
    const [event] = parseWhatsappWebhook(
      wabaWebhook("template_category_update", TEMPLATE_CATEGORY_UPCOMING)
    ).templateCategories

    expect(event).toMatchObject({
      category: "utility",
      upcomingCategory: "MARKETING",
    })
  })
})

describe("message_template_quality_update", () => {
  it("lee el cambio de calidad", () => {
    const batch = parseWhatsappWebhook(
      wabaWebhook("message_template_quality_update", TEMPLATE_QUALITY)
    )

    expect(batch.templateQuality).toEqual([
      expect.objectContaining({
        name: "welcome_template",
        previousQuality: "GREEN",
        newQuality: "YELLOW",
      }),
    ])
  })
})

describe("lote mixto", () => {
  it("un field desconocido no rompe el resto del lote", () => {
    const batch = parseWhatsappWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: WABA_ID,
          time: 1751247548,
          changes: [
            { field: "algo_nuevo_de_meta", value: { foo: "bar" } },
            {
              field: "message_template_status_update",
              value: TEMPLATE_REJECTED,
            },
            // Sin `value`: basura, se descarta sola.
            { field: "template_category_update" },
            {
              field: "message_template_quality_update",
              value: TEMPLATE_QUALITY,
            },
            {
              field: "account_update",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                event: "VERIFIED_ACCOUNT",
              },
            },
          ],
        },
      ],
    })

    expect(batch.templateStatuses).toHaveLength(1)
    expect(batch.templateCategories).toEqual([])
    expect(batch.templateQuality).toHaveLength(1)
    // `algo_nuevo_de_meta` no trae `metadata` y se pierde en silencio, como
    // cualquier cambio sin número; `account_update` sí la trae y se reporta.
    expect(batch.unhandledFields).toEqual(["account_update"])
  })
})
