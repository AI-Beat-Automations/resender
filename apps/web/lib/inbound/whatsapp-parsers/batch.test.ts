import { describe, expect, it } from "vitest"

import {
  extractWhatsappContactSync,
  extractWhatsappEchoes,
  extractWhatsappHistory,
  extractWhatsappMessages,
  extractWhatsappStatuses,
  parseWhatsappWebhook,
} from "./index"
import {
  PHONE_NUMBER_ID,
  TEMPLATE_STATUS_APPROVED,
  USER_PHONE,
  WABA_ID,
  message,
} from "./test-fixtures"

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
              field: "phone_number_quality_update",
              value: { metadata: { phone_number_id: PHONE_NUMBER_ID } },
            },
            {
              // Un campo de ámbito WABA que sí modelamos y que llega **sin**
              // `metadata`: tiene que convivir en el mismo POST con los de
              // mensajería sin quitarle nada a ninguno.
              field: "message_template_status_update",
              value: TEMPLATE_STATUS_APPROVED,
            },
            {
              // Y uno de ámbito WABA que no modelamos, que antes desaparecía
              // sin dejar rastro porque el sobre lo tiraba por no traer
              // `phone_number_id`.
              field: "account_update",
              value: { event: "VERIFIED_ACCOUNT" },
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
    expect(batch.templates).toEqual([
      expect.objectContaining({ kind: "status", status: "APPROVED" }),
    ])
    expect(batch.unhandledFields).toEqual([
      "phone_number_quality_update",
      "account_update",
    ])
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
      templates: [],
      unhandledFields: [],
    })
    expect(extractWhatsappMessages(payload)).toEqual([])
    expect(extractWhatsappStatuses(payload)).toEqual([])
    expect(extractWhatsappHistory(payload)).toEqual([])
    expect(extractWhatsappContactSync(payload)).toEqual([])
    expect(extractWhatsappEchoes(payload)).toEqual([])
  })

  // Para la mensajería el WABA no enruta nada: el enrutado va por
  // `metadata.phone_number_id` y el sobre del webhook del tenant usa la columna
  // `waba_id` de la cuenta conectada. Descartar el `entry` por él tiraría todos
  // sus mensajes reales —y en silencio— por un campo que ahí es decorativo. Los
  // eventos de plantilla sí lo necesitan, y por eso los descarta su parser y no
  // el sobre (ver `templates.test.ts`).
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
          // Meta documenta `id` como string y manda un número JSON. El sobre lo
          // lee con `asTextId`, así que llega igual.
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
    expect(batch.messages.map((event) => event.wabaId)).toEqual([null, WABA_ID])
  })

  // El test de arriba fijaba lo contrario —`wabaId: null` para el `entry.id`
  // numérico— y eso dejó de describir el comportamiento deseado: mientras el
  // WABA era decorativo, perderlo por venir como número era inofensivo, pero
  // desde la 0014 es un tercio de la clave con la que se llavea el espejo de
  // plantillas, y perderlo descarta el evento entero sin dejar rastro —el
  // `field` matchea su `case`, así que ni siquiera cae en `unhandledFields`—.
  // La normalización vive en el sobre, una sola vez, y por eso los mensajes lo
  // conservan también.
  it("normaliza a string el entry.id numérico, que ahora es clave del espejo", () => {
    const batch = parseWhatsappWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: Number(WABA_ID),
          changes: [
            {
              field: "message_template_status_update",
              value: TEMPLATE_STATUS_APPROVED,
            },
          ],
        },
      ],
    })

    expect(batch.templates).toHaveLength(1)
    expect(batch.templates[0]!.wabaId).toBe(WABA_ID)
    expect(batch.unhandledFields).toEqual([])
  })
})
