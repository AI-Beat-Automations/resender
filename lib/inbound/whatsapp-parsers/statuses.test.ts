import { describe, expect, it } from "vitest"

import { extractWhatsappMessages, extractWhatsappStatuses } from "./batch"
import { PHONE_NUMBER_ID, USER_PHONE, WABA_ID, webhook } from "./test-fixtures"

describe("WhatsApp statuses", () => {
  const status = (overrides: Record<string, unknown>) =>
    extractWhatsappStatuses(
      webhook("messages", {
        statuses: [
          {
            id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
            timestamp: "1750030073",
            recipient_id: USER_PHONE,
            ...overrides,
          },
        ],
      })
    )

  it("reads a sent status carrying the envelope and the recipient", () => {
    expect(
      status({
        status: "sent",
        conversation: {
          id: "72b14d6bd5407799e66f64d1b338e567",
          expiration_timestamp: "1750116480",
          origin: { type: "marketing" },
        },
        pricing: {
          billable: true,
          pricing_model: "PMP",
          type: "regular",
          category: "marketing",
        },
      })
    ).toEqual([
      {
        wabaId: WABA_ID,
        providerPhoneNumberId: PHONE_NUMBER_ID,
        metaMessageId:
          "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
        deliveryStatus: "sent",
        recipientId: USER_PHONE,
        timestamp: new Date(1_750_030_073_000),
        errors: [],
        pricing: {
          billable: true,
          category: "marketing",
          type: "regular",
          pricingModel: "PMP",
        },
      },
    ])
  })

  // Desde el 1 de octubre de 2026 Meta cobra los mensajes de servicio
  // entregados (ADR 0023): el bloque es el único dato que dice cuáles.
  it("reads the pricing block of a delivered service message", () => {
    expect(
      status({
        status: "delivered",
        pricing: {
          billable: true,
          pricing_model: "PMP",
          type: "regular",
          category: "service",
        },
      })[0]!.pricing
    ).toEqual({
      billable: true,
      category: "service",
      type: "regular",
      pricingModel: "PMP",
    })
  })

  it("leaves pricing null when the status carries no block", () => {
    const [event] = status({ status: "read" })

    expect(event!.pricing).toBeNull()
    expect(event!.deliveryStatus).toBe("read")
  })

  // Sin `billable` el bloque no dice lo único que importa. Se trata como
  // ausente, pero el acuse se procesa igual.
  it.each([
    ["not an object", "PMP"],
    ["an array", [{ billable: true }]],
    ["missing billable", { category: "service", type: "regular" }],
    ["a string billable", { billable: "true", category: "service" }],
  ])("leaves pricing null when the block is %s", (_, pricing) => {
    const [event] = status({ status: "delivered", pricing })

    expect(event!.pricing).toBeNull()
    expect(event!.deliveryStatus).toBe("delivered")
  })

  // Meta añade valores sin cambiar de versión de API y el valor de `type` para
  // el cupo gratis no está documentado: se guarda tal cual, nunca se descarta.
  it("keeps unknown pricing values verbatim instead of dropping them", () => {
    expect(
      status({
        status: "delivered",
        pricing: {
          billable: false,
          pricing_model: "PMP_V2",
          type: "free_customer_service",
          category: "service_intervention",
        },
      })[0]!.pricing
    ).toEqual({
      billable: false,
      category: "service_intervention",
      type: "free_customer_service",
      pricingModel: "PMP_V2",
    })
  })

  it.each([
    ["sent", "sent"],
    ["delivered", "delivered"],
    ["read", "read"],
    ["failed", "failed"],
  ])("maps the reported status %s to %s", (reported, expected) => {
    expect(status({ status: reported })[0]!.deliveryStatus).toBe(expected)
  })

  // `played` llega la primera vez que se reproduce una nota de voz y no existe
  // en el CHECK de `delivery_status` (0017 §5). Es monotónicamente equivalente
  // a `read`, y mapearlo ahorra una migración cuyo único aporte sería un estado
  // que ninguna vista distingue.
  it("maps played to read instead of dropping it or demanding a migration", () => {
    expect(status({ status: "played" })[0]!.deliveryStatus).toBe("read")
  })

  it("carries the Meta error of a failed send so the diagnosis survives", () => {
    expect(
      status({
        status: "failed",
        errors: [
          {
            code: 131049,
            title:
              "This message was not delivered to maintain healthy ecosystem engagement.",
            message:
              "This message was not delivered to maintain healthy ecosystem engagement.",
            error_data: {
              details:
                "In order to maintain a healthy ecosystem engagement, the message failed to be delivered.",
            },
            href: "/documentation/business-messaging/whatsapp/support/error-codes",
          },
        ],
      })[0]!.errors
    ).toEqual([
      {
        code: 131049,
        title:
          "This message was not delivered to maintain healthy ecosystem engagement.",
        message:
          "This message was not delivered to maintain healthy ecosystem engagement.",
        details:
          "In order to maintain a healthy ecosystem engagement, the message failed to be delivered.",
      },
    ])
  })

  // La columna tiene un CHECK: inventarle un valor rompería el insert del lote
  // entero por un estado que ni siquiera sabemos leer.
  it("drops a status value it cannot map to the column enum", () => {
    expect(status({ status: "teletransportado" })).toEqual([])
  })

  it("does not confuse statuses with inbound messages", () => {
    const payload = webhook("messages", {
      statuses: [
        { id: "wamid.1", status: "delivered", timestamp: "1750030073" },
      ],
    })

    expect(extractWhatsappMessages(payload)).toEqual([])
    expect(extractWhatsappStatuses(payload)).toHaveLength(1)
  })
})
