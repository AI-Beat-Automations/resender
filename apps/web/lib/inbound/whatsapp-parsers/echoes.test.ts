import { describe, expect, it } from "vitest"

import { extractWhatsappEchoes, extractWhatsappMessages } from "./batch"
import {
  BUSINESS_PHONE,
  PHONE_NUMBER_ID,
  TEMPORARY_MEDIA_URL,
  USER_PHONE,
  WABA_ID,
  webhook,
} from "./test-fixtures"

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
        metaMessageId:
          "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA",
        text: "Here's the info you requested! https://www.meta.com/quest/quest-3/",
        attachment: null,
        replyToMetaMessageId: null,
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

    expect(event!.attachment!.type).toBe("unknown")
    expect(event!.attachment!.details).toEqual({
      rawType: "revoke",
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

    expect(event!.attachment!.type).toBe("unknown")
    expect(JSON.stringify(event)).not.toContain(TEMPORARY_MEDIA_URL)
    expect(event!.attachment!.details).toMatchObject({ rawType: "edit" })
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
