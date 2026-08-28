import { describe, expect, it } from "vitest"

import {
  BUSINESS_PHONE,
  PHONE_NUMBER_ID,
  TEMPLATE_CATEGORY_COMPLETED,
  TEMPLATE_QUALITY_DROP,
  TEMPLATE_STATUS_APPROVED,
  USER_PHONE,
  WABA_ID,
  message,
  templateWebhook,
  webhook,
} from "./whatsapp-parsers/test-fixtures"
import { routeWhatsappWebhook } from "./whatsapp-webhook"

// Los payloads salen de los fixtures de los parsers, que son los literales de
// la documentación de Meta. Este módulo no vuelve a probar el parseo —eso ya
// tiene 76 tests al lado—: prueba **la traducción**, que es donde un rename mal
// hecho manda un mensaje a la conversación equivocada.

const inbound = (...messages: Array<Record<string, unknown>>) =>
  webhook("messages", {
    contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: USER_PHONE }],
    messages,
  })

const WAMID = "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA="

describe("puente de WhatsApp hacia el evento neutro", () => {
  it("traduce un texto entrante al contrato que consume la ingesta", () => {
    const routed = routeWhatsappWebhook(
      inbound(message({ type: "text", text: { body: "Hola" } }))
    )

    expect(routed.events).toEqual([
      {
        eventType: "message",
        // La cuenta se resuelve por `phone_number_id`, que es lo que
        // `connected_pages.meta_page_id` guarda en este canal (0017 §2).
        metaPageId: PHONE_NUMBER_ID,
        senderId: USER_PHONE,
        text: "Hola",
        attachment: null,
        metaMessageId: WAMID,
        postbackPayload: null,
        timestamp: new Date(1_749_416_383_000),
        direction: "inbound",
        origin: "customer",
        historical: false,
        deliveryStatus: null,
        attachmentStatus: null,
        providerMediaId: null,
        replyToMetaMessageId: null,
      },
    ])
  })

  // El evento neutro promete `text: string`. Un mensaje sin texto propio
  // —ubicación, pedido, evento de sistema— llega con `null` del parser.
  it("convierte el texto ausente en cadena vacía, no en null", () => {
    const [event] = routeWhatsappWebhook(
      inbound(
        message({
          type: "location",
          location: { latitude: -34.6, longitude: -58.4 },
        })
      )
    ).events

    expect(event!.text).toBe("")
    expect(event!.attachment).toMatchObject({ type: "location" })
  })

  // El adjunto viaja **sin URL**: la de Meta dura cinco minutos y va
  // autenticada. Lo que sobrevive es el id con el que se pide la descarga.
  it("saca el estado del binario y el id de media del adjunto", () => {
    const [pending] = routeWhatsappWebhook(
      inbound(
        message({
          type: "document",
          document: {
            id: "622684793477189",
            mime_type: "application/pdf",
            filename: "receipt.pdf",
          },
        })
      )
    ).events

    expect(pending!.attachment).toEqual({
      type: "file",
      url: null,
      title: null,
      details: {
        providerMediaId: "622684793477189",
        mimeType: "application/pdf",
        filename: "receipt.pdf",
      },
    })
    expect(pending!.attachmentStatus).toBe("pending")
    expect(pending!.providerMediaId).toBe("622684793477189")

    // Sin id de asset no hay descarga posible: se marca y no se encola nada.
    const [unavailable] = routeWhatsappWebhook(
      inbound(message({ type: "image", image: { mime_type: "image/jpeg" } }))
    ).events

    expect(unavailable!.attachmentStatus).toBe("unavailable")
    expect(unavailable!.providerMediaId).toBeNull()
  })

  // **La traducción que no es un rename.** En un echo el `from` de Meta es el
  // número del negocio; usarlo como interlocutor abriría una conversación del
  // negocio consigo mismo.
  it("usa el cliente como interlocutor del echo, nunca el número del negocio", () => {
    const [echo] = routeWhatsappWebhook(
      webhook("smb_message_echoes", {
        message_echoes: [
          {
            from: BUSINESS_PHONE,
            to: USER_PHONE,
            id: WAMID,
            timestamp: "1739321024",
            type: "text",
            text: { body: "Ahí va" },
          },
        ],
      })
    ).events

    expect(echo).toMatchObject({
      senderId: USER_PHONE,
      direction: "outbound",
      origin: "business_app",
      historical: false,
    })
  })

  it("marca el historial como histórico y arrastra su estado de entrega", () => {
    const routed = routeWhatsappWebhook(
      webhook("history", {
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 100 },
            threads: [
              {
                id: USER_PHONE,
                messages: [
                  {
                    from: BUSINESS_PHONE,
                    id: WAMID,
                    timestamp: "1739230955",
                    type: "text",
                    text: { body: "Acá está" },
                    history_context: { status: "READ" },
                  },
                ],
              },
            ],
          },
        ],
      })
    )

    expect(routed.events).toHaveLength(1)
    expect(routed.events[0]).toMatchObject({
      senderId: USER_PHONE,
      direction: "outbound",
      origin: "history",
      historical: true,
      deliveryStatus: "read",
    })

    // El chunk entero se devuelve además de sus mensajes: `progress === 100` es
    // la única señal de que la sincronización terminó y viaja ahí.
    expect(routed.history).toHaveLength(1)
    expect(routed.history[0]!.progress).toBe(100)
  })

  // Los tres orígenes salen en una sola lista y en un orden fijo: mensajes
  // vivos, echoes e historial.
  it("junta mensajes, echoes e historial en una sola lista ordenada", () => {
    const routed = routeWhatsappWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "102290129340398",
          changes: [
            ...inbound(message({ type: "text", text: { body: "vivo" } }))
              .entry[0]!.changes,
            ...webhook("smb_message_echoes", {
              message_echoes: [
                {
                  from: BUSINESS_PHONE,
                  to: USER_PHONE,
                  id: "wamid.echo",
                  timestamp: "1739321024",
                  type: "text",
                  text: { body: "eco" },
                },
              ],
            }).entry[0]!.changes,
          ],
        },
      ],
    })

    expect(routed.events.map((event) => event.text)).toEqual(["vivo", "eco"])
    expect(routed.events.map((event) => event.origin)).toEqual([
      "customer",
      "business_app",
    ])
  })

  // Los acuses no son mensajes: no crean fila y por eso no entran en `events`.
  it("devuelve los acuses aparte de los mensajes", () => {
    const routed = routeWhatsappWebhook(
      webhook("messages", {
        statuses: [
          {
            id: WAMID,
            status: "read",
            timestamp: "1749416400",
            recipient_id: USER_PHONE,
          },
        ],
      })
    )

    expect(routed.events).toEqual([])
    expect(routed.statuses).toEqual([
      expect.objectContaining({
        metaMessageId: WAMID,
        deliveryStatus: "read",
        providerPhoneNumberId: PHONE_NUMBER_ID,
      }),
    ])
  })

  // Los eventos de plantilla son de ámbito WABA: no tienen conversación, no
  // tienen contacto y no producen fila de `messages`. Lo que sí tienen es un
  // efecto —el `update` del espejo—, y este módulo es el único camino entre el
  // parser y la ingesta: lo que no se propaga acá se pierde en silencio, que es
  // exactamente lo que pasaba antes de que `templates` existiera en el tipo.
  it("propaga los eventos de plantilla sin convertirlos en mensajes", () => {
    const routed = routeWhatsappWebhook(
      templateWebhook("message_template_status_update", {
        ...TEMPLATE_STATUS_APPROVED,
      })
    )

    expect(routed.events).toEqual([])
    expect(routed.unhandledFields).toEqual([])
    expect(routed.templates).toEqual([
      expect.objectContaining({
        kind: "status",
        wabaId: WABA_ID,
        name: "order_confirmation",
        // Con guion, como lo manda Meta. Normalizarlo es trabajo del espejo,
        // que es el que conoce la otra punta.
        language: "en-US",
        status: "APPROVED",
      }),
    ])
  })

  // Los tres campos de plantilla salen por la misma lista, discriminados por
  // `kind`: el consumidor resuelve la misma fila del espejo para los tres y
  // tres listas le habrían pedido tres bucles.
  it("junta los tres campos de plantilla en una sola lista", () => {
    const routed = routeWhatsappWebhook({
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              value: TEMPLATE_CATEGORY_COMPLETED,
              field: "template_category_update",
            },
            {
              value: TEMPLATE_QUALITY_DROP,
              field: "message_template_quality_update",
            },
          ],
        },
      ],
      object: "whatsapp_business_account",
    })

    expect(routed.templates.map((event) => event.kind)).toEqual([
      "category",
      "quality",
    ])
  })

  // Un `field` nuevo de Meta tiene que aparecer en la bitácora, no
  // desaparecer: la ruta lo registra desde acá.
  it("propaga los campos que ningún parser modela", () => {
    // `message_template_status_update` era el ejemplo hasta que la 0014 le puso
    // parser propio. Este tiene que ser siempre uno **sin** modelar.
    const routed = routeWhatsappWebhook(
      webhook("phone_number_quality_update", { event: "FLAGGED" })
    )

    expect(routed.events).toEqual([])
    expect(routed.unhandledFields).toEqual(["phone_number_quality_update"])
  })

  it("no revienta con un cuerpo que no tiene forma de sobre", () => {
    expect(routeWhatsappWebhook(null)).toEqual({
      events: [],
      statuses: [],
      contactSync: [],
      history: [],
      templates: [],
      unhandledFields: [],
    })
  })
})
