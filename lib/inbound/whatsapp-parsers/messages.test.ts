import { describe, expect, it } from "vitest"

import { extractWhatsappMessages } from "./batch"
import {
  BUSINESS_PHONE,
  PHONE_NUMBER_ID,
  USER_PHONE,
  WABA_ID,
  message,
  only,
  webhook,
} from "./test-fixtures"

describe("WhatsApp inbound messages", () => {
  it("normalizes a text message with the envelope taken from entry and metadata", () => {
    expect(
      only(
        message({
          type: "text",
          text: { body: "Does it come in another color?" },
        })
      )
    ).toEqual({
      // `entry[].id` es el WABA; el número conectado se resuelve por
      // `metadata.phone_number_id`, no por el WABA ni por el número visible.
      wabaId: WABA_ID,
      providerPhoneNumberId: PHONE_NUMBER_ID,
      direction: "inbound",
      contactId: USER_PHONE,
      senderId: USER_PHONE,
      contactName: "Sheena Nelson",
      metaMessageId:
        "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
      text: "Does it come in another color?",
      // Un texto es lo único que se persiste sin adjunto: `attachment_type`
      // null **es** el discriminador de "esto es texto".
      attachment: null,
      replyToMetaMessageId: null,
      origin: "customer",
      historical: false,
      deliveryStatus: null,
      errors: [],
      createdAt: new Date(1_749_416_383_000),
    })
  })

  it("reads context.id as the message being replied to", () => {
    expect(
      only(
        message({
          context: {
            from: BUSINESS_PHONE,
            id: "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=",
          },
          type: "text",
          text: { body: "sí, en azul" },
        })
      ).replyToMetaMessageId
    ).toBe("wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=")
  })

  // Meta documenta `wa_id` sin `+` y `from` con `+` en las tablas, y los manda
  // los dos sin `+` en los ejemplos. Comparar en crudo dejaría al contacto sin
  // nombre según qué versión de la doc acierte.
  it("crosses the profile name by wa_id even if one of the two carries a plus sign", () => {
    const events = extractWhatsappMessages(
      webhook("messages", {
        contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: USER_PHONE }],
        messages: [
          message({
            from: `+${USER_PHONE}`,
            type: "text",
            text: { body: "hola" },
          }),
        ],
      })
    )

    expect(events[0]!.contactName).toBe("Sheena Nelson")
    // El identificador se guarda tal cual lo mandó Meta: reconstruirlo es
    // arriesgarse a contestarle a un número que no existe.
    expect(events[0]!.senderId).toBe(`+${USER_PHONE}`)
  })

  // El ejemplo oficial de `system` llega sin `value.contacts[]`.
  it("does not assume contacts exist just because messages do", () => {
    const events = extractWhatsappMessages(
      webhook("messages", {
        messages: [message({ type: "text", text: { body: "hola" } })],
      })
    )

    expect(events[0]!.contactName).toBeNull()
  })

  // Meta agrega hasta 1000 updates por POST: un elemento roto no puede llevarse
  // por delante el lote entero.
  it("keeps the valid message of a batch where another one is corrupt", () => {
    const events = extractWhatsappMessages(
      webhook("messages", {
        messages: [
          null,
          {
            id: "wamid.sin-remitente",
            type: "text",
            text: { body: "huérfano" },
          },
          "no soy un objeto",
          message({
            id: "wamid.bueno",
            type: "text",
            text: { body: "sobrevivo" },
          }),
        ],
      })
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.metaMessageId).toBe("wamid.bueno")
  })

  it("survives entries and changes that are corrupt", () => {
    expect(
      extractWhatsappMessages({
        object: "whatsapp_business_account",
        entry: [
          null,
          { changes: [] },
          { id: WABA_ID, changes: "no-soy-array" },
          {
            id: WABA_ID,
            // Sin `phone_number_id` no hay número conectado al que atribuirlo.
            changes: [
              { field: "messages", value: { messages: [message({})] } },
            ],
          },
          {
            id: WABA_ID,
            changes: [
              {
                value: {
                  metadata: { phone_number_id: PHONE_NUMBER_ID },
                  messages: [
                    message({ type: "text", text: { body: "sin field" } }),
                  ],
                },
              },
            ],
          },
        ],
      })
    ).toEqual([])
  })
})

describe("WhatsApp timestamps", () => {
  // WhatsApp manda segundos como string, al revés que los webhooks de mensajes
  // de Messenger e Instagram. Leerlos como milisegundos fecha todo en 1970.
  it("reads a seconds-as-string timestamp without landing in 1970", () => {
    const event = only(
      message({ timestamp: "1749416383", type: "text", text: { body: "hola" } })
    )

    expect(event.createdAt.getTime()).toBe(1_749_416_383_000)
    expect(event.createdAt.getUTCFullYear()).toBe(2025)
  })

  it("does not multiply a value that already comes in milliseconds", () => {
    const event = only(
      message({
        timestamp: 1_749_416_383_000,
        type: "text",
        text: { body: "hola" },
      })
    )

    expect(event.createdAt.getTime()).toBe(1_749_416_383_000)
  })

  it("falls back to now instead of throwing on a timestamp that is not a number", () => {
    const before = Date.now()
    const event = only(
      message({ timestamp: "ayer", type: "text", text: { body: "hola" } })
    )

    expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})
