import { describe, expect, it } from "vitest"

import { extractWhatsappHistory, extractWhatsappMessages } from "./batch"
import {
  BUSINESS_PHONE,
  PHONE_NUMBER_ID,
  USER_PHONE,
  WABA_ID,
  webhook,
} from "./test-fixtures"

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

  // Los multimedia del historial llegan primero sin ID de asset. Los de más de
  // 14 días se quedan así para siempre: hay binario y no lo tenemos, que es
  // exactamente lo que significa `unavailable`. El llamador lo marca y **no
  // encola nada**; reintentar sería reintentar algo que no existe.
  it("keeps a media_placeholder and flags it as unavailable", () => {
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
      attachment: {
        type: "unknown",
        details: { rawType: "media_placeholder" },
        providerMediaId: null,
        status: "unavailable",
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
      metaMessageId:
        "wamid.QyNUEHBgLMTY0NjcwNDM1OTUVAgARGBI1Rj3NEYxMzAzMzQ5MkEA",
      historical: true,
      origin: "history",
      direction: "inbound",
      contactId: USER_PHONE,
      threadId: null,
    })
    // Este sí trae asset: es de los últimos 14 días y hay descarga que encolar.
    expect(chunks[0]!.messages[0]!.attachment).toMatchObject({
      type: "image",
      providerMediaId: "24230790383178626",
      status: "pending",
    })
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
