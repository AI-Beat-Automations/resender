import { describe, expect, it } from "vitest"

import { TEMPORARY_MEDIA_URL, message, only } from "./test-fixtures"

// Un solo discriminador de contenido: `attachment_type` (0017 §6). Lo que antes
// era `message_type` + `content` es ahora el tipo del adjunto y su
// `attachment_meta`, y el texto solo existe para el tipo `text` y para el pie
// de foto de la media.

describe("WhatsApp content mapping", () => {
  // Los 14 tipos entrantes con página de referencia propia. La tabla existe
  // para que añadir un tipo nuevo al catálogo obligue a decidir aquí a qué se
  // mapea, en vez de descubrirlo en producción.
  it.each([
    // El texto es el único sin adjunto.
    ["text", { type: "text", text: { body: "hola" } }, null],
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
    // `document` **no** es un tipo del catálogo: `file` ya estaba y son el
    // mismo concepto con dos nombres.
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
      "file",
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
    // `button` no está en el catálogo: es la respuesta a un botón de plantilla
    // y entra como `interactive`.
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
  ])(
    "maps the incoming type %s to the attachment type %s",
    (_name, payload, expected) => {
      expect(only(message(payload)).attachment?.type ?? null).toBe(expected)
    }
  )

  it("puts media in the attachment, taking the caption as the text", () => {
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

    // El pie de foto es el texto del mensaje y **no** se duplica dentro del
    // jsonb: dos copias del mismo string es una que se puede desincronizar.
    expect(event.text).toBe("my receipt")
    expect(event.attachment).toEqual({
      type: "file",
      title: null,
      details: {
        providerMediaId: "622684793477189",
        mimeType: "application/pdf",
        sha256: "V5OPpLD/gEG6Xjg0MbmQDLFgcKsL+j5LfY4ny/pZ4MY=",
        filename: "receipt.pdf",
      },
      providerMediaId: "622684793477189",
      // Hay ID de asset: el llamador encola la descarga.
      status: "pending",
    })
  })

  // El ID de media es lo único con lo que se puede pedir la descarga después.
  // Sin él no hay nada que encolar y el adjunto queda marcado, no reintentado.
  it("marks media without an asset id as unavailable instead of pending", () => {
    const event = only(
      message({ type: "image", image: { mime_type: "image/jpeg" } })
    )

    expect(event.attachment).toEqual({
      type: "image",
      title: null,
      details: { mimeType: "image/jpeg" },
      providerMediaId: null,
      status: "unavailable",
    })
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
    const silent = only(
      message({
        type: "audio",
        audio: { mime_type: "audio/mpeg", id: "1908647269898589" },
      })
    )

    expect(note.attachment!.details.voice).toBe(true)
    expect(file.attachment!.details.voice).toBe(false)
    // Ausente, no `false`: este payload no lo dice.
    expect(silent.attachment!.details).not.toHaveProperty("voice")
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

    expect(event.attachment!.details.animated).toBe(true)
    expect(event.text).toBeNull()
  })

  it("reads a location into the attachment meta", () => {
    const event = only(
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
    )

    expect(event.attachment).toEqual({
      type: "location",
      title: null,
      details: {
        latitude: 37.44221496582,
        longitude: -122.16165924072,
        name: "Philz Coffee",
        address: "101 Forest Ave, Palo Alto, CA 94301",
      },
      providerMediaId: null,
      // No hay binario que bajar: el llamador deja `attachment_status` en null.
      status: null,
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
      ).attachment!.details
    ).toEqual({ latitude: 37.44, longitude: -122.16 })
  })

  // Sin las dos coordenadas no hay punto que construir: se conserva el payload
  // antes que fabricar una ubicación falsa.
  it("keeps a location without coordinates raw instead of inventing a point", () => {
    expect(
      only(message({ type: "location", location: { name: "Philz Coffee" } }))
        .attachment!.details
    ).toEqual({ raw: { name: "Philz Coffee" } })
  })

  // `messages[].contacts[]` (tarjeta compartida) no es `value.contacts[]`
  // (perfil del remitente), aunque se llamen igual.
  it("reads a shared contact card without confusing it with the sender profile", () => {
    const card = {
      name: {
        first_name: "Barbara",
        last_name: "Johnson",
        formatted_name: "Barbara J. Johnson",
      },
      org: { company: "Social Tsunami" },
      phones: [
        { phone: "+1 (415) 555-0829", wa_id: "14125550829", type: "MOBILE" },
      ],
    }
    const event = only(message({ type: "contacts", contacts: [card] }))

    expect(event.contactName).toBe("Sheena Nelson")
    expect(event.attachment!.details).toEqual({
      contacts: [
        {
          name: "Barbara J. Johnson",
          phones: ["+1 (415) 555-0829"],
          raw: card,
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
      ).attachment!.details
    ).toEqual({ emoji: "👍", targetMetaMessageId: target })

    const removed = only(
      message({ type: "reaction", reaction: { message_id: target } })
    )
    expect(removed.attachment!.details).toEqual({
      targetMetaMessageId: target,
    })
    // El vínculo de una reacción va en el meta, **no** en
    // `reply_to_meta_message_id`: una reacción no usa `context`.
    expect(removed.replyToMetaMessageId).toBeNull()
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

    expect(list.attachment!.details).toMatchObject({
      interactiveType: "list_reply",
    })
    expect(flow.attachment!.details).toMatchObject({
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

    expect(event.attachment!.type).toBe("interactive")
    expect(event.attachment!.details).toEqual({
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

    expect(event.attachment!.type).toBe("order")
    expect(event.text).toBeNull()
    expect(event.attachment!.details).toEqual({ raw: order })
  })

  it("marks a system event as produced by the system, not by the contact", () => {
    const system = {
      body: "User Sheena Nelson changed from 16505551234 to 12195555358",
      wa_id: "12195555358",
      type: "user_changed_number",
    }
    const event = only(message({ type: "system", system }))

    expect(event.attachment!.type).toBe("system")
    expect(event.origin).toBe("system")
    expect(event.text).toBeNull()
    expect(event.attachment!.details).toEqual({ raw: system })
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

    expect(event.attachment).toEqual({
      type: "unknown",
      title: null,
      // El tipo real de Meta se conserva en el meta: es lo que permite medir
      // qué está llegando antes de decidir si merece modelarse.
      details: { rawType: "unsupported", raw: { type: "poll_creation" } },
      providerMediaId: null,
      status: null,
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
  // silencio ni se disfraza de texto. Meta añade tipos sin cambiar de versión
  // de API.
  it("does not drop a message type invented after this parser was written", () => {
    const event = only(
      message({
        type: "quantum_hologram",
        quantum_hologram: { qubits: 12, entangled_with: "wamid.otro" },
      })
    )

    expect(event.text).toBeNull()
    expect(event.attachment).toEqual({
      type: "unknown",
      title: null,
      details: {
        rawType: "quantum_hologram",
        raw: { qubits: 12, entangled_with: "wamid.otro" },
      },
      providerMediaId: null,
      status: null,
    })
  })

  // Un tipo sin objeto homónimo no puede quedarse sin `rawType`: eso es todo lo
  // que quedaría para saber qué llegó.
  it("keeps the raw type of an unknown message that carries no payload", () => {
    expect(only(message({ type: "quantum_hologram" })).attachment).toEqual({
      type: "unknown",
      title: null,
      details: { rawType: "quantum_hologram" },
      providerMediaId: null,
      status: null,
    })
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
    // Lo que sobrevive es el ID, con el que la descarga se pide cuando toca.
    expect(event.attachment!.providerMediaId).toBe("1003383421387256")
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
    expect(event.attachment!.details).toEqual({
      rawType: "quantum_hologram",
      raw: { projection: { mime_type: "image/jpeg" } },
    })
  })
})
