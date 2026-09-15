import { describe, expect, it } from "vitest"

import {
  extractWhatsappContactSync,
  extractWhatsappEchoes,
  extractWhatsappHistory,
  extractWhatsappMessages,
  extractWhatsappStatuses,
  parseWhatsappWebhook,
} from "./index"
import { PHONE_NUMBER_ID, USER_PHONE, WABA_ID, message } from "./test-fixtures"

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
              // Un campo al que estamos suscritos y estos parsers no modelan.
              // Se reporta para que la ingesta lo registre, en vez de
              // tragárselo.
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
