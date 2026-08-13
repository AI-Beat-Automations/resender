import { describe, expect, it } from "vitest"

import {
  extractWhatsappContactSync,
  extractWhatsappEchoes,
  extractWhatsappHistory,
  extractWhatsappMessages,
  extractWhatsappStatuses,
  parseWhatsappWebhook,
} from "./whatsapp-events"

// Los fixtures son los payloads literales de la documentación de Meta —mismos
// `wamid`, mismos `sha256`, mismos números—, no invenciones: un parser probado
// contra payloads imaginados solo demuestra que coincide consigo mismo.
const WABA_ID = "102290129340398"
const PHONE_NUMBER_ID = "106540352242922"
const BUSINESS_PHONE = "15550783881"
const USER_PHONE = "16505551234"
// La URL de descarga que Meta empezó a incluir en noviembre de 2025 y que
// caduca a los cinco minutos. No debe sobrevivir a ningún parser.
const TEMPORARY_MEDIA_URL =
  "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=133"

const webhook = (field: string, value: Record<string, unknown>) => ({
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

const message = (overrides: Record<string, unknown>) => ({
  from: USER_PHONE,
  id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
  timestamp: "1749416383",
  ...overrides,
})

const inbound = (...messages: Array<Record<string, unknown>>) =>
  webhook("messages", {
    contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: USER_PHONE }],
    messages,
  })

const only = (...messages: Array<Record<string, unknown>>) => {
  const events = extractWhatsappMessages(inbound(...messages))
  expect(events).toHaveLength(messages.length)
  return events[0]!
}

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
      providerMessageId:
        "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
      type: "text",
      text: "Does it come in another color?",
      content: null,
      attachments: [],
      replyToProviderMessageId: null,
      origin: "customer",
      historical: false,
      deliveryStatus: null,
      errors: [],
      createdAt: new Date(1_749_416_383_000),
    })
  })

  // Los 14 tipos entrantes con página de referencia propia. La tabla existe
  // para que añadir un tipo nuevo al contrato obligue a decidir aquí a qué se
  // mapea, en vez de descubrirlo en producción.
  it.each([
    ["text", { type: "text", text: { body: "hola" } }, "text"],
    [
      "image",
      {
        type: "image",
        image: {
          caption: "Taj Mahal",
          mime_type: "image/jpeg",
          sha256: "SfInY0gGKTsJlUWbwxC1k+FAD0FZHvzwfpvO0zX0GUI=",
          id: "1003383421387256",
        },
      },
      "image",
    ],
    [
      "audio",
      {
        type: "audio",
        audio: {
          mime_type: "audio/ogg; codecs=opus",
          sha256: "wvqXMe6n7n1W0zphvLPoLj+s/NtKqmr3zZ7YzTP7xFI=",
          id: "1908647269898587",
          voice: true,
        },
      },
      "audio",
    ],
    [
      "video",
      {
        type: "video",
        video: {
          caption: "Timelapse of growth",
          mime_type: "video/mp4",
          sha256: "vdGU5X4caz12KwFgYwpljlUNqMt1YnkH+5GkPc3mMnc=",
          id: "731675419373506",
        },
      },
      "video",
    ],
    [
      "document",
      {
        type: "document",
        document: {
          caption: "my receipt",
          filename: "receipt.pdf",
          mime_type: "application/pdf",
          sha256: "V5OPpLD/gEG6Xjg0MbmQDLFgcKsL+j5LfY4ny/pZ4MY=",
          id: "622684793477189",
        },
      },
      "document",
    ],
    [
      "sticker",
      {
        type: "sticker",
        sticker: {
          mime_type: "image/webp",
          sha256: "wvqXMe6n7n1W0zphvLPoLj+s/NtKqmr3zZ7YzTP7xFI=",
          id: "1908647269898587",
          animated: true,
        },
      },
      "sticker",
    ],
    [
      "location",
      {
        type: "location",
        location: {
          address: "101 Forest Ave, Palo Alto, CA 94301",
          latitude: 37.44221496582,
          longitude: -122.16165924072,
          name: "Philz Coffee",
          url: "https://philzcoffee.com/",
        },
      },
      "location",
    ],
    [
      "contacts",
      {
        type: "contacts",
        contacts: [
          {
            name: {
              first_name: "Barbara",
              last_name: "Johnson",
              formatted_name: "Barbara J. Johnson",
            },
            org: { company: "Social Tsunami" },
            phones: [
              {
                phone: "+1 (415) 555-0829",
                wa_id: "14125550829",
                type: "MOBILE",
              },
            ],
          },
        ],
      },
      "contacts",
    ],
    [
      "reaction",
      {
        type: "reaction",
        reaction: {
          message_id:
            "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=",
          emoji: "👍",
        },
      },
      "reaction",
    ],
    [
      "interactive",
      {
        type: "interactive",
        interactive: {
          type: "list_reply",
          list_reply: {
            id: "priority_express",
            title: "Priority Mail Express",
            description: "Next Day to 2 Days",
          },
        },
      },
      "interactive",
    ],
    // `button` no es un tipo del contrato: es la respuesta a un botón de
    // plantilla y entra como `interactive`.
    [
      "button",
      {
        type: "button",
        button: { payload: "Unsubscribe", text: "Unsubscribe" },
      },
      "interactive",
    ],
    [
      "order",
      {
        type: "order",
        order: {
          catalog_id: "194836987003835",
          text: "Love these!",
          product_items: [
            {
              product_retailer_id: "di9ozbzfi4",
              quantity: 2,
              item_price: 30,
              currency: "USD",
            },
          ],
        },
      },
      "order",
    ],
    [
      "system",
      {
        type: "system",
        system: {
          body: "User Sheena Nelson changed from 16505551234 to 12195555358",
          wa_id: "12195555358",
          type: "user_changed_number",
        },
      },
      "system",
    ],
    // `unsupported` es el cajón de sastre de Meta (encuestas, mensajes fijados,
    // ediciones) y aquí se convierte en el nuestro.
    [
      "unsupported",
      { type: "unsupported", unsupported: { type: "edit" } },
      "unknown",
    ],
  ])("maps the incoming type %s to %s", (_name, payload, expected) => {
    expect(only(message(payload)).type).toBe(expected)
  })

  it("puts media on attachments and leaves content null, taking the caption as the text", () => {
    const event = only(
      message({
        type: "document",
        document: {
          caption: "my receipt",
          filename: "receipt.pdf",
          mime_type: "application/pdf",
          sha256: "V5OPpLD/gEG6Xjg0MbmQDLFgcKsL+j5LfY4ny/pZ4MY=",
          id: "622684793477189",
        },
      })
    )

    expect(event.content).toBeNull()
    expect(event.text).toBe("my receipt")
    expect(event.attachments).toEqual([
      {
        kind: "document",
        providerMediaId: "622684793477189",
        mimeType: "application/pdf",
        sha256: "V5OPpLD/gEG6Xjg0MbmQDLFgcKsL+j5LfY4ny/pZ4MY=",
        filename: "receipt.pdf",
        caption: "my receipt",
        voice: null,
        animated: null,
      },
    ])
  })

  // `voice` distingue "mantuvo pulsado el micro" de "adjuntó un mp3", y Meta
  // manda los dos valores explícitos: la ausencia del campo no es `false`.
  it("distinguishes a voice note from an attached audio file", () => {
    const note = only(
      message({
        type: "audio",
        audio: {
          mime_type: "audio/ogg; codecs=opus",
          sha256: "wvqXMe6n7n1W0zphvLPoLj+s/NtKqmr3zZ7YzTP7xFI=",
          id: "1908647269898587",
          voice: true,
        },
      })
    )
    const file = only(
      message({
        type: "audio",
        audio: {
          mime_type: "audio/mpeg",
          sha256: "wvqXMe6n7n1W0zphvLPoLj+s/NtKqmr3zZ7YzTP7xFI=",
          id: "1908647269898588",
          voice: false,
        },
      })
    )

    expect(note.attachments[0]!.voice).toBe(true)
    expect(file.attachments[0]!.voice).toBe(false)
    // El audio no admite pie de foto en WhatsApp.
    expect(note.text).toBeNull()
  })

  it("keeps the animated flag of a sticker", () => {
    const event = only(
      message({
        type: "sticker",
        sticker: {
          mime_type: "image/webp",
          sha256: "wvqXMe6n7n1W0zphvLPoLj+s/NtKqmr3zZ7YzTP7xFI=",
          id: "1908647269898587",
          animated: true,
        },
      })
    )

    expect(event.attachments[0]!.animated).toBe(true)
    expect(event.text).toBeNull()
  })

  it("reads a location as typed content", () => {
    expect(
      only(
        message({
          type: "location",
          location: {
            address: "101 Forest Ave, Palo Alto, CA 94301",
            latitude: 37.44221496582,
            longitude: -122.16165924072,
            name: "Philz Coffee",
            url: "https://philzcoffee.com/",
          },
        })
      ).content
    ).toEqual({
      kind: "location",
      latitude: 37.44221496582,
      longitude: -122.16165924072,
      name: "Philz Coffee",
      address: "101 Forest Ave, Palo Alto, CA 94301",
    })
  })

  // Una ubicación soltada en el mapa no trae ni nombre ni dirección.
  it("reads a bare location without name or address", () => {
    expect(
      only(
        message({
          type: "location",
          location: { latitude: 37.44, longitude: -122.16 },
        })
      ).content
    ).toEqual({
      kind: "location",
      latitude: 37.44,
      longitude: -122.16,
      name: null,
      address: null,
    })
  })

  // `messages[].contacts[]` (tarjeta compartida) no es `value.contacts[]`
  // (perfil del remitente), aunque se llamen igual.
  it("reads a shared contact card without confusing it with the sender profile", () => {
    const event = only(
      message({
        type: "contacts",
        contacts: [
          {
            name: {
              first_name: "Barbara",
              last_name: "Johnson",
              formatted_name: "Barbara J. Johnson",
            },
            org: { company: "Social Tsunami" },
            phones: [
              {
                phone: "+1 (415) 555-0829",
                wa_id: "14125550829",
                type: "MOBILE",
              },
            ],
          },
        ],
      })
    )

    expect(event.contactName).toBe("Sheena Nelson")
    expect(event.content).toEqual({
      kind: "contacts",
      contacts: [
        {
          name: "Barbara J. Johnson",
          phones: ["+1 (415) 555-0829"],
          raw: {
            name: {
              first_name: "Barbara",
              last_name: "Johnson",
              formatted_name: "Barbara J. Johnson",
            },
            org: { company: "Social Tsunami" },
            phones: [
              {
                phone: "+1 (415) 555-0829",
                wa_id: "14125550829",
                type: "MOBILE",
              },
            ],
          },
        },
      ],
    })
  })

  // La ausencia de `emoji` ES la señal de reacción retirada: no hay flag.
  it("reads a reaction and tells a removed one by the missing emoji", () => {
    const target =
      "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA="

    expect(
      only(
        message({
          type: "reaction",
          reaction: { message_id: target, emoji: "👍" },
        })
      ).content
    ).toEqual({
      kind: "reaction",
      emoji: "👍",
      targetProviderMessageId: target,
    })

    expect(
      only(message({ type: "reaction", reaction: { message_id: target } }))
        .content
    ).toEqual({
      kind: "reaction",
      emoji: null,
      targetProviderMessageId: target,
    })
  })

  it("keeps the interactive discriminator open instead of closing it to the two documented replies", () => {
    const list = only(
      message({
        type: "interactive",
        interactive: {
          type: "list_reply",
          list_reply: {
            id: "priority_express",
            title: "Priority Mail Express",
          },
        },
      })
    )
    // `nfm_reply` (WhatsApp Flows) no está en la referencia de `interactive`;
    // cerrar el enum lo perdería entero.
    const flow = only(
      message({
        type: "interactive",
        interactive: { type: "nfm_reply", nfm_reply: { response_json: "{}" } },
      })
    )

    expect(list.content).toMatchObject({
      kind: "interactive",
      interactiveType: "list_reply",
    })
    expect(flow.content).toMatchObject({
      kind: "interactive",
      interactiveType: "nfm_reply",
    })
  })

  // El botón de plantilla es un `type` propio de Meta, distinto de
  // `interactive.button_reply`, pero es el mismo hecho: el usuario pulsó algo
  // que le ofrecimos.
  it("folds a template button reply into interactive keeping its payload", () => {
    const event = only(
      message({
        type: "button",
        button: { payload: "Unsubscribe", text: "Unsubscribe" },
      })
    )

    expect(event.type).toBe("interactive")
    expect(event.content).toEqual({
      kind: "interactive",
      interactiveType: "button",
      payload: { payload: "Unsubscribe", text: "Unsubscribe" },
    })
    // El texto se queda en null: la etiqueta del botón es presentación, no el
    // cuerpo de un mensaje.
    expect(event.text).toBeNull()
  })

  it("keeps an order whole instead of flattening it into fake text", () => {
    const order = {
      catalog_id: "194836987003835",
      text: "Love these!",
      product_items: [
        {
          product_retailer_id: "di9ozbzfi4",
          quantity: 2,
          item_price: 30,
          currency: "USD",
        },
      ],
    }
    const event = only(message({ type: "order", order }))

    expect(event.type).toBe("order")
    expect(event.text).toBeNull()
    expect(event.content).toEqual({
      kind: "generic_event",
      eventType: "order",
      raw: order,
    })
  })

  it("marks a system event as produced by the system, not by the contact", () => {
    const system = {
      body: "User Sheena Nelson changed from 16505551234 to 12195555358",
      wa_id: "12195555358",
      type: "user_changed_number",
    }
    const event = only(message({ type: "system", system }))

    expect(event.type).toBe("system")
    expect(event.origin).toBe("system")
    expect(event.text).toBeNull()
    expect(event.content).toEqual({
      kind: "generic_event",
      eventType: "system",
      raw: system,
    })
  })

  it("turns unsupported into unknown keeping the payload and the Meta error", () => {
    const event = only(
      message({
        type: "unsupported",
        unsupported: { type: "poll_creation" },
        errors: [
          {
            code: 131051,
            title: "Message type unknown",
            message: "Message type unknown",
            error_data: { details: "Message type is currently not supported." },
          },
        ],
      })
    )

    expect(event.type).toBe("unknown")
    expect(event.content).toEqual({
      kind: "generic_event",
      eventType: "unsupported",
      raw: { type: "poll_creation" },
    })
    // Sin el error no se distingue "tipo desconocido" del 131060 de
    // Coexistence, que es el primer mensaje a un número onboardeado.
    expect(event.errors).toEqual([
      {
        code: 131051,
        title: "Message type unknown",
        message: "Message type unknown",
        details: "Message type is currently not supported.",
      },
    ])
  })

  // Criterio de aceptación explícito: ningún mensaje desconocido se pierde en
  // silencio. Meta añade tipos sin cambiar de versión de API.
  it("does not drop a message type invented after this parser was written", () => {
    const event = only(
      message({
        type: "quantum_hologram",
        quantum_hologram: { qubits: 12, entangled_with: "wamid.otro" },
      })
    )

    expect(event.type).toBe("unknown")
    expect(event.content).toEqual({
      kind: "generic_event",
      eventType: "quantum_hologram",
      raw: { qubits: 12, entangled_with: "wamid.otro" },
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
      ).replyToProviderMessageId
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
    expect(events[0]!.providerMessageId).toBe("wamid.bueno")
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

describe("WhatsApp media urls", () => {
  // La URL viene en el propio webhook desde noviembre de 2025 y caduca a los
  // cinco minutos: persistirla deja un secreto muerto en la base.
  it("never lets the temporary media url reach the output", () => {
    const event = only(
      message({
        type: "image",
        image: {
          caption: "Taj Mahal",
          mime_type: "image/jpeg",
          sha256: "SfInY0gGKTsJlUWbwxC1k+FAD0FZHvzwfpvO0zX0GUI=",
          id: "1003383421387256",
          url: TEMPORARY_MEDIA_URL,
        },
      })
    )

    expect(JSON.stringify(event)).not.toContain(TEMPORARY_MEDIA_URL)
    expect(event.attachments[0]!.providerMediaId).toBe("1003383421387256")
  })

  // Un tipo desconocido futuro puede traer media, y su payload se conserva en
  // crudo: el barrido tiene que ser recursivo o la URL entra por esa puerta.
  it("strips the url nested inside a raw payload it does not model", () => {
    const event = only(
      message({
        type: "quantum_hologram",
        quantum_hologram: {
          projection: { mime_type: "image/jpeg", url: TEMPORARY_MEDIA_URL },
        },
      })
    )

    expect(JSON.stringify(event)).not.toContain(TEMPORARY_MEDIA_URL)
    expect(event.content).toEqual({
      kind: "generic_event",
      eventType: "quantum_hologram",
      raw: { projection: { mime_type: "image/jpeg" } },
    })
  })
})

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
        providerMessageId:
          "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
        deliveryStatus: "sent",
        recipientId: USER_PHONE,
        timestamp: new Date(1_750_030_073_000),
        errors: [],
      },
    ])
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
  // ni en `DeliveryStatusSchema` ni en el CHECK de la migración 0015. Es
  // monotónicamente equivalente a `read`, y mapearlo ahorra una migración cuyo
  // único aporte sería un estado que ninguna vista distingue.
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
  it("drops a status value it cannot map to the contract enum", () => {
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

describe("WhatsApp message echoes", () => {
  const echo = (overrides: Record<string, unknown>) =>
    extractWhatsappEchoes(
      webhook("smb_message_echoes", {
        message_echoes: [
          {
            // Invertido respecto a `messages[]`: `from` es el negocio.
            from: BUSINESS_PHONE,
            to: USER_PHONE,
            id: "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA",
            timestamp: "1739321024",
            ...overrides,
          },
        ],
      })
    )

  // Leer `from` como si fuera el contacto crearía una conversación del negocio
  // consigo mismo, y el mensaje saliente se guardaría como entrante.
  it("takes the contact from `to`, because in an echo `from` is the business", () => {
    expect(
      echo({
        type: "text",
        text: {
          body: "Here's the info you requested! https://www.meta.com/quest/quest-3/",
        },
      })
    ).toEqual([
      {
        wabaId: WABA_ID,
        providerPhoneNumberId: PHONE_NUMBER_ID,
        direction: "outbound",
        contactId: USER_PHONE,
        senderId: BUSINESS_PHONE,
        contactName: null,
        providerMessageId:
          "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA",
        type: "text",
        text: "Here's the info you requested! https://www.meta.com/quest/quest-3/",
        content: null,
        attachments: [],
        replyToProviderMessageId: null,
        // Distinguirlo de `resender_api` es lo que evita que el sistema se
        // automatice sobre su propia respuesta.
        origin: "business_app",
        historical: false,
        deliveryStatus: null,
        errors: [],
        createdAt: new Date(1_739_321_024_000),
      },
    ])
  })

  // Lo más parecido a un borrado que existe, y solo en Coexistence. El `id` del
  // evento no es el del mensaje borrado.
  it("keeps a revoke whole instead of guessing what to delete", () => {
    const [event] = echo({
      type: "revoke",
      revoke: {
        original_message_id:
          "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=",
      },
    })

    expect(event!.type).toBe("unknown")
    expect(event!.content).toEqual({
      kind: "generic_event",
      eventType: "revoke",
      raw: {
        original_message_id:
          "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=",
      },
    })
  })

  // El `edit` trae un mensaje anidado completo, con su propia URL temporal de
  // media dentro.
  it("keeps an edit whole and still strips the nested temporary url", () => {
    const [event] = echo({
      type: "edit",
      edit: {
        original_message_id:
          "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=",
        message: {
          context: { id: "M0" },
          type: "image",
          image: {
            caption: "Updated image caption",
            mime_type: "image/jpeg",
            sha256: "a1b2c3d4e5f6",
            id: "1234567890",
            url: TEMPORARY_MEDIA_URL,
          },
        },
      },
    })

    expect(event!.type).toBe("unknown")
    expect(JSON.stringify(event)).not.toContain(TEMPORARY_MEDIA_URL)
    expect(event!.content).toMatchObject({
      kind: "generic_event",
      eventType: "edit",
    })
  })

  it("does not report echoes as inbound messages", () => {
    const payload = webhook("smb_message_echoes", {
      message_echoes: [
        {
          from: BUSINESS_PHONE,
          to: USER_PHONE,
          id: "wamid.eco",
          timestamp: "1739321024",
          type: "text",
          text: { body: "hola" },
        },
      ],
    })

    expect(extractWhatsappMessages(payload)).toEqual([])
    expect(extractWhatsappEchoes(payload)).toHaveLength(1)
  })
})

describe("WhatsApp contact sync", () => {
  const sync = (...items: unknown[]) =>
    extractWhatsappContactSync(
      webhook("smb_app_state_sync", { state_sync: items })
    )

  // El array se llama `state_sync[]`, no `contacts[]`, y una **edición** de
  // contacto llega como `add`: el consumidor hace upsert, no insert.
  it("reads an add with the full contact", () => {
    expect(
      sync({
        type: "contact",
        contact: {
          full_name: "Pablo Morales",
          first_name: "Pablo",
          phone_number: USER_PHONE,
        },
        action: "add",
        metadata: { timestamp: "1739321024" },
      })
    ).toEqual([
      {
        wabaId: WABA_ID,
        providerPhoneNumberId: PHONE_NUMBER_ID,
        action: "add",
        phoneNumber: USER_PHONE,
        fullName: "Pablo Morales",
        firstName: "Pablo",
        timestamp: new Date(1_739_321_024_000),
      },
    ])
  })

  // En un `remove` solo llega el teléfono: la clave de deduplicación no puede
  // ser el nombre.
  it("reads a remove that only carries the phone number", () => {
    expect(
      sync({
        type: "contact",
        contact: { phone_number: USER_PHONE },
        action: "remove",
        metadata: { timestamp: "1739321024" },
      })
    ).toEqual([
      {
        wabaId: WABA_ID,
        providerPhoneNumberId: PHONE_NUMBER_ID,
        action: "remove",
        phoneNumber: USER_PHONE,
        fullName: null,
        firstName: null,
        timestamp: new Date(1_739_321_024_000),
      },
    ])
  })

  it("drops entries without a phone number or with an action it does not know", () => {
    expect(
      sync(
        {
          type: "contact",
          contact: { full_name: "Sin teléfono" },
          action: "add",
        },
        {
          type: "contact",
          contact: { phone_number: USER_PHONE },
          action: "update",
        },
        null
      )
    ).toEqual([])
  })
})

describe("WhatsApp history", () => {
  // Primera forma: chunks con hilos. `progress === 100` es la única señal
  // documentada de que la sincronización terminó, así que el chunk se devuelve
  // entero en vez de aplanar los mensajes.
  it("reads the threaded chunk shape keeping the sync metadata", () => {
    const chunks = extractWhatsappHistory(
      webhook("history", {
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 55 },
            threads: [
              {
                id: USER_PHONE,
                messages: [
                  {
                    from: BUSINESS_PHONE,
                    id: "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA",
                    timestamp: "1739230955",
                    type: "text",
                    text: { body: "Here's the info you requested!" },
                    history_context: { status: "READ" },
                  },
                  {
                    from: USER_PHONE,
                    id: "wamid.N0FCNjMAHBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0",
                    timestamp: "1739230970",
                    type: "text",
                    text: { body: "Thanks!" },
                    history_context: { status: "READ" },
                  },
                ],
              },
            ],
          },
        ],
      })
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      wabaId: WABA_ID,
      providerPhoneNumberId: PHONE_NUMBER_ID,
      phase: 0,
      chunkOrder: 1,
      progress: 55,
      errors: [],
    })

    const [outbound, inboundMessage] = chunks[0]!.messages
    // La dirección sale de comparar `from` con el hilo, que se identifica por
    // el teléfono del interlocutor y no por un ID opaco.
    expect(outbound).toMatchObject({
      direction: "outbound",
      contactId: USER_PHONE,
      senderId: BUSINESS_PHONE,
      threadId: USER_PHONE,
      origin: "history",
      historical: true,
      deliveryStatus: "read",
      createdAt: new Date(1_739_230_955_000),
    })
    expect(inboundMessage).toMatchObject({
      direction: "inbound",
      contactId: USER_PHONE,
      senderId: USER_PHONE,
      historical: true,
    })
  })

  // `history_context.status` va en MAYÚSCULAS y trae dos valores que
  // `statuses[].status` no tiene. Compartir la tabla de mapeo dejaría todo el
  // historial sin estado de entrega.
  it.each([
    ["SENT", "sent"],
    ["DELIVERED", "delivered"],
    ["READ", "read"],
    ["PLAYED", "read"],
    ["ERROR", "failed"],
    ["PENDING", "accepted"],
    ["lowercase", null],
  ])("maps the uppercase history status %s to %s", (reported, expected) => {
    const chunks = extractWhatsappHistory(
      webhook("history", {
        history: [
          {
            metadata: { phase: 2, chunk_order: 1, progress: 100 },
            threads: [
              {
                id: USER_PHONE,
                messages: [
                  {
                    from: USER_PHONE,
                    id: "wamid.estado",
                    timestamp: "1739230970",
                    type: "text",
                    text: { body: "hola" },
                    history_context: { status: reported },
                  },
                ],
              },
            ],
          },
        ],
      })
    )

    expect(chunks[0]!.messages[0]!.deliveryStatus).toBe(expected)
  })

  // Los multimedia del historial llegan primero sin ID de asset.
  it("keeps a media_placeholder instead of dropping it", () => {
    const chunks = extractWhatsappHistory(
      webhook("history", {
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 55 },
            threads: [
              {
                id: USER_PHONE,
                messages: [
                  {
                    from: BUSINESS_PHONE,
                    id: "wamid.QyNUEHBgLMTY0NjcwNDM1OTUVAgARGBI1Rj3NEYxMzAzMzQ5MkEA",
                    timestamp: "1739230970",
                    type: "media_placeholder",
                    history_context: { status: "PLAYED" },
                  },
                ],
              },
            ],
          },
        ],
      })
    )

    expect(chunks[0]!.messages[0]).toMatchObject({
      type: "unknown",
      content: {
        kind: "generic_event",
        eventType: "media_placeholder",
        raw: null,
      },
      deliveryStatus: "read",
    })
  })

  // Segunda forma del mismo `field`: los IDs de los assets llegan en
  // `value.messages[]`, no en `value.history[]`. Discriminar por el `field`
  // los metería en la conversación como mensajes recién llegados, abriendo la
  // ventana de 24 h y reenviándolos al webhook del tenant.
  it("reads the media-id shape that arrives under value.messages", () => {
    const payload = webhook("history", {
      messages: [
        {
          from: USER_PHONE,
          id: "wamid.QyNUEHBgLMTY0NjcwNDM1OTUVAgARGBI1Rj3NEYxMzAzMzQ5MkEA",
          timestamp: "1738796547",
          type: "image",
          image: {
            caption: "Black Prince echeveria",
            mime_type: "image/jpeg",
            sha256:
              "3f9d94d399fa61c191bc1d4ca71375a035cd9b9f5b1128e1f0963a415c16b0cc",
            id: "24230790383178626",
          },
        },
      ],
    })
    const chunks = extractWhatsappHistory(payload)

    // Trae el mismo `wamid` que el `media_placeholder` que llegó antes, pero
    // **nadie los casa todavía**: la ingesta solo inserta, así que esta segunda
    // forma choca contra el dedupe y el multimedia del historial se pierde.
    // Reconciliarlos es requisito del slice que active Coexistence; el parser
    // solo garantiza que el dato llegue entero hasta ahí.
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      phase: null,
      chunkOrder: null,
      progress: null,
    })
    expect(chunks[0]!.messages[0]).toMatchObject({
      providerMessageId:
        "wamid.QyNUEHBgLMTY0NjcwNDM1OTUVAgARGBI1Rj3NEYxMzAzMzQ5MkEA",
      type: "image",
      historical: true,
      origin: "history",
      direction: "inbound",
      contactId: USER_PHONE,
      threadId: null,
    })
    expect(chunks[0]!.messages[0]!.attachments[0]!.providerMediaId).toBe(
      "24230790383178626"
    )
    // Y sobre todo: no son mensajes entrantes de ahora.
    expect(extractWhatsappMessages(payload)).toEqual([])
  })

  it("reads a chunk that only carries the error of a business that turned history off", () => {
    const chunks = extractWhatsappHistory(
      webhook("history", {
        history: [
          {
            errors: [
              {
                code: 2593109,
                title:
                  "History sync is turned off by the business from the WhatsApp Business App",
                message:
                  "History sync is turned off by the business from the WhatsApp Business App",
                error_data: {
                  details: "History sharing is turned off by the business",
                },
              },
            ],
          },
        ],
      })
    )

    expect(chunks[0]!.messages).toEqual([])
    expect(chunks[0]!.errors[0]!.code).toBe(2593109)
  })
})

describe("WhatsApp webhook batch", () => {
  it("groups a POST that mixes fields and does not let an unknown one break it", () => {
    const batch = parseWhatsappWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [message({ type: "text", text: { body: "hola" } })],
                statuses: [
                  {
                    id: "wamid.1",
                    status: "delivered",
                    timestamp: "1750030073",
                  },
                ],
              },
            },
            {
              // Un campo al que estamos suscritos y este parser no modela. Se
              // reporta para que el servicio lo registre, en vez de tragárselo.
              field: "message_template_status_update",
              value: { metadata: { phone_number_id: PHONE_NUMBER_ID } },
            },
            {
              field: "smb_app_state_sync",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                state_sync: [
                  {
                    type: "contact",
                    contact: { phone_number: USER_PHONE },
                    action: "remove",
                    metadata: { timestamp: "1739321024" },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(batch.messages).toHaveLength(1)
    expect(batch.statuses).toHaveLength(1)
    expect(batch.contactSync).toHaveLength(1)
    expect(batch.history).toEqual([])
    expect(batch.echoes).toEqual([])
    expect(batch.unhandledFields).toEqual(["message_template_status_update"])
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["un objeto vacío", {}],
    ["un entry que no es array", { entry: "no-soy-array" }],
    ["un string", "whatsapp"],
    ["un array", []],
  ])("returns empty results without throwing for %s", (_name, payload) => {
    expect(() => parseWhatsappWebhook(payload)).not.toThrow()
    expect(parseWhatsappWebhook(payload)).toEqual({
      messages: [],
      statuses: [],
      history: [],
      contactSync: [],
      echoes: [],
      unhandledFields: [],
    })
    expect(extractWhatsappMessages(payload)).toEqual([])
    expect(extractWhatsappStatuses(payload)).toEqual([])
    expect(extractWhatsappHistory(payload)).toEqual([])
    expect(extractWhatsappContactSync(payload)).toEqual([])
    expect(extractWhatsappEchoes(payload)).toEqual([])
  })

  // El WABA no enruta nada y ningún consumidor lo lee: el enrutado va por
  // `metadata.phone_number_id` y el sobre del webhook del tenant usa la columna
  // `waba_id` de la cuenta conectada. Descartar el `entry` por él tiraría todos
  // sus mensajes reales —y en silencio— por un campo decorativo.
  it("no descarta el entry al que le falta el id ni aquel cuyo id es un número", () => {
    const batch = parseWhatsappWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          // Sin `id`.
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [message({ type: "text", text: { body: "uno" } })],
              },
            },
          ],
        },
        {
          // Meta documenta `id` como string, pero un JSON numérico es
          // exactamente lo que `asString` devuelve como null.
          id: Number(WABA_ID),
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  {
                    ...message({ type: "text", text: { body: "dos" } }),
                    id: "wamid.dos",
                  },
                ],
              },
            },
          ],
        },
        // Lo que sí sigue siendo basura: un `entry` que ni siquiera es objeto.
        "no-soy-un-entry",
      ],
    })

    expect(batch.messages.map((event) => event.text)).toEqual(["uno", "dos"])
    expect(batch.messages.map((event) => event.wabaId)).toEqual([null, null])
  })
})
