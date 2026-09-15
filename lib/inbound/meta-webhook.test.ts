import { describe, expect, it } from "vitest"

import { extractInboundEvents } from "./meta-webhook"

describe("Meta webhook extraction", () => {
  it("extracts text messages and ignores non-message events", () => {
    const [message] = extractInboundEvents({
      entry: [
        {
          id: "page_1",
          messaging: [
            {
              sender: { id: "psid_1" },
              timestamp: 1700000000000,
              message: { mid: "mid_1", text: " hola " },
            },
            { sender: { id: "psid_2" }, message: { mid: "mid_2" } },
          ],
        },
      ],
    })

    expect(message).toMatchObject({
      eventType: "message",
      metaPageId: "page_1",
      senderId: "psid_1",
      text: "hola",
      metaMessageId: "mid_1",
      postbackPayload: null,
    })
  })

  it("extracts postbacks as inbound events", () => {
    const [event] = extractInboundEvents({
      entry: [
        {
          id: "page_1",
          messaging: [
            {
              sender: { id: "psid_1" },
              timestamp: 1700000000000,
              postback: { title: "Start", payload: "GET_STARTED" },
            },
          ],
        },
      ],
    })

    expect(event).toMatchObject({
      eventType: "postback",
      metaPageId: "page_1",
      senderId: "psid_1",
      text: "GET_STARTED",
      postbackPayload: "GET_STARTED",
    })
    expect(event?.metaMessageId).toBe(
      "postback:page_1:psid_1:1700000000000:R0VUX1NUQVJURUQ"
    )
  })
})

// Sobre mínimo con un solo messaging entry, para no repetir el envoltorio en
// cada caso de adjuntos.
const envelope = (message: Record<string, unknown>) => ({
  entry: [
    {
      id: "page_1",
      messaging: [
        {
          sender: { id: "psid_1" },
          timestamp: 1700000000000,
          message,
        },
      ],
    },
  ],
})

describe("adjuntos entrantes de Messenger", () => {
  it("acepta un mensaje de solo imagen, con details vacio", () => {
    const [event] = extractInboundEvents(
      envelope({
        mid: "mid_img",
        attachments: [
          { type: "image", payload: { url: "https://cdn.meta.test/foto.jpg" } },
        ],
      })
    )

    expect(event?.eventType).toBe("message")
    expect(event?.text).toBe("")
    expect(event?.metaMessageId).toBe("mid_img")
    expect(event?.attachment).toEqual({
      type: "image",
      url: "https://cdn.meta.test/foto.jpg",
      title: null,
      details: {},
    })
  })

  // Un share con comentario trae texto Y adjunto; se persisten los dos.
  it("conserva texto y adjunto cuando el share viene comentado", () => {
    const [event] = extractInboundEvents(
      envelope({
        mid: "mid_share",
        text: "  mira esto  ",
        attachments: [
          {
            type: "fallback",
            payload: {
              url: "https://ejemplo.test/nota",
              title: "Una nota",
            },
          },
        ],
      })
    )

    expect(event?.text).toBe("mira esto")
    expect(event?.attachment).toEqual({
      type: "fallback",
      url: "https://ejemplo.test/nota",
      title: "Una nota",
      details: {},
    })
  })

  // Hasta el 30 ago 2026 Meta manda cada sticker duplicado como image +
  // sticker con la misma URL: quitar el gemelo es normalizar, no perder, y por
  // eso no hay droppedCount.
  it("dedupe del gemelo image del sticker sin contar descarte", () => {
    const [event] = extractInboundEvents(
      envelope({
        mid: "mid_sticker",
        attachments: [
          {
            type: "image",
            payload: { url: "https://cdn.meta.test/sticker.png" },
          },
          {
            type: "sticker",
            payload: {
              url: "https://cdn.meta.test/sticker.png",
              sticker_id: 369239263222822,
            },
          },
        ],
      })
    )

    expect(event?.attachment).toEqual({
      type: "sticker",
      url: "https://cdn.meta.test/sticker.png",
      title: null,
      details: { stickerId: "369239263222822" },
    })
  })

  // Dos adjuntos distintos si son perdida real: queda el primero y el conteo.
  it("se queda con el primero y cuenta los descartados", () => {
    const [event] = extractInboundEvents(
      envelope({
        mid: "mid_multi",
        attachments: [
          { type: "image", payload: { url: "https://cdn.meta.test/a.jpg" } },
          { type: "video", payload: { url: "https://cdn.meta.test/b.mp4" } },
        ],
      })
    )

    expect(event?.attachment).toEqual({
      type: "image",
      url: "https://cdn.meta.test/a.jpg",
      title: null,
      details: { droppedCount: 1 },
    })
  })

  it("normaliza una reserva sin URL con el booking completo", () => {
    const [event] = extractInboundEvents(
      envelope({
        mid: "mid_booking",
        attachments: [
          {
            type: "appointment_booking",
            payload: {
              booking_id: "book_1",
              status: "CONFIRMED",
              start_time: 1700001000,
              end_time: 1700004600,
              timezone: "America/Argentina/Buenos_Aires",
            },
          },
        ],
      })
    )

    expect(event?.attachment).toEqual({
      type: "appointment_booking",
      url: null,
      title: null,
      details: {
        booking: {
          bookingId: "book_1",
          status: "CONFIRMED",
          startTime: 1700001000,
          endTime: 1700004600,
          timezone: "America/Argentina/Buenos_Aires",
        },
      },
    })
  })

  // Un tipo que Meta invente despues no se pierde: entra como unknown con su
  // nombre real y el elemento crudo completo.
  it("mapea un tipo desconocido a unknown con rawType y raw", () => {
    const raw = {
      type: "location",
      payload: { url: "https://maps.test/punto", title: "Punto" },
    }
    const [event] = extractInboundEvents(
      envelope({ mid: "mid_loc", attachments: [raw] })
    )

    expect(event?.attachment).toEqual({
      type: "unknown",
      url: "https://maps.test/punto",
      title: "Punto",
      details: { rawType: "location", raw },
    })
  })

  it("los postbacks siguen saliendo con attachment null", () => {
    const [event] = extractInboundEvents({
      entry: [
        {
          id: "page_1",
          messaging: [
            {
              sender: { id: "psid_1" },
              timestamp: 1700000000000,
              postback: { title: "Start", payload: "GET_STARTED" },
            },
          ],
        },
      ],
    })

    expect(event?.eventType).toBe("postback")
    expect(event?.attachment).toBeNull()
  })

  it("tira el mensaje sin texto, sin adjuntos y sin postback", () => {
    expect(extractInboundEvents(envelope({ mid: "mid_empty" }))).toEqual([])
    expect(
      extractInboundEvents(envelope({ mid: "mid_blank", text: "   " }))
    ).toEqual([])
  })
})
