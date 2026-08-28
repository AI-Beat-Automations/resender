import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sendWhatsappMessage: vi.fn(),
}))

// Sólo el envío sale a la red. `buildWhatsappMessagePayload`,
// `explainWhatsappError` y los extractores son puros y se dejan reales: si se
// mockearan, este test dejaría de probar la forma del sobre que Meta recibe.
vi.mock("@/lib/meta/whatsapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meta/whatsapp-client")>()),
  sendWhatsappMessage: mocks.sendWhatsappMessage,
}))

import { OUTBOUND_ATTACHMENT_TYPES } from "./send-request"
import {
  buildWhatsappOutboundPayload,
  explainWhatsappError,
  extractWhatsappMessageId,
  sendWhatsappOutboundMessage,
  toWhatsappOutboundMessage,
  WHATSAPP_MEDIA_TYPE_BY_ATTACHMENT,
} from "./whatsapp-send"

const accepted = {
  ok: true,
  status: 200,
  data: { messages: [{ id: "wamid.HBg1" }] },
  error: null,
  reason: null,
  code: null,
}

describe("whatsapp outbound content", () => {
  it("maps a text reply to a Cloud API text message", () => {
    expect(
      toWhatsappOutboundMessage({ reply: "hola", attachment: null })
    ).toEqual({ text: "hola" })
  })

  // La clave del objeto **es** el tipo: `{ type: "image", image: { link } }`.
  // Mandar `attachment` —la forma de Messenger— da un 400 genérico de Meta.
  it("builds the media envelope with the type as the key", () => {
    expect(
      buildWhatsappOutboundPayload("5491100000000", {
        reply: null,
        attachment: { type: "image", url: "https://cdn.example.com/foto.png" },
      })
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5491100000000",
      type: "image",
      image: { link: "https://cdn.example.com/foto.png" },
    })
  })

  // El único renombre entre los dos vocabularios: el `file` público es el
  // `document` de Cloud API.
  it("renames the public file type to document", () => {
    expect(
      buildWhatsappOutboundPayload("5491100000000", {
        reply: null,
        attachment: {
          type: "file",
          url: "https://cdn.example.com/factura.pdf",
        },
      })
    ).toMatchObject({
      type: "document",
      document: { link: "https://cdn.example.com/factura.pdf" },
    })
  })

  // La plantilla es la única de las tres que no se traduce: nombre e idioma es
  // lo único que Cloud API acepta al enviar, así que el contrato público y el
  // de Meta coinciden campo por campo (ADR 0014).
  it("passes the template through without translating it", () => {
    const components = [
      { type: "body", parameters: [{ type: "text", text: "A-1024" }] },
    ]

    expect(
      toWhatsappOutboundMessage({
        reply: null,
        attachment: null,
        template: { name: "order_update", language: "es", components },
      })
    ).toEqual({
      template: { name: "order_update", language: "es", components },
    })
  })

  // El único cambio de forma lo pone el builder: `language` es un objeto con
  // `code` y no el string suelto que viaja por el contrato público.
  it("builds the template envelope with language as an object", () => {
    expect(
      buildWhatsappOutboundPayload("5491100000000", {
        reply: null,
        attachment: null,
        template: { name: "hello_world", language: "en_US" },
      })
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5491100000000",
      type: "template",
      template: { name: "hello_world", language: { code: "en_US" } },
    })
  })

  it("covers every public attachment type", () => {
    for (const type of OUTBOUND_ATTACHMENT_TYPES) {
      expect(WHATSAPP_MEDIA_TYPE_BY_ATTACHMENT[type]).toBeTruthy()
    }
  })

  // Sin `preview_url` prendido: la tarjeta del primer enlace cambiaría cómo se
  // ve el mensaje que el tenant escribió sin que él lo haya pedido.
  it("does not turn link previews on by itself", () => {
    expect(
      buildWhatsappOutboundPayload("5491100000000", {
        reply: "mirá https://resender.dev",
        attachment: null,
      })
    ).toMatchObject({
      type: "text",
      text: { body: "mirá https://resender.dev", preview_url: false },
    })
  })
})

describe("sendWhatsappOutboundMessage", () => {
  beforeEach(() => {
    mocks.sendWhatsappMessage.mockReset()
    mocks.sendWhatsappMessage.mockResolvedValue(accepted)
  })

  it("sends through the Cloud API client with the translated message", async () => {
    const result = await sendWhatsappOutboundMessage({
      accessToken: "token-1",
      phoneNumberId: "phone-1",
      to: "5491100000000",
      content: { reply: "hola", attachment: null },
    })

    expect(mocks.sendWhatsappMessage).toHaveBeenCalledWith({
      accessToken: "token-1",
      phoneNumberId: "phone-1",
      to: "5491100000000",
      message: { text: "hola" },
    })
    expect(result).toBe(accepted)
  })

  it("sends media by link, never by uploaded id", async () => {
    await sendWhatsappOutboundMessage({
      accessToken: "token-1",
      phoneNumberId: "phone-1",
      to: "5491100000000",
      content: {
        reply: null,
        attachment: { type: "video", url: "https://cdn.example.com/v.mp4" },
      },
    })

    expect(mocks.sendWhatsappMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          media: { type: "video", link: "https://cdn.example.com/v.mp4" },
        },
      })
    )
  })

  // La ruta de plantillas entra por el mismo adaptador y no por el cliente de
  // Meta: es el único lugar donde los dos vocabularios se tocan y agregar un
  // segundo envío habría abierto un segundo lugar donde desincronizarse.
  it("sends a template through the same adapter as free-form", async () => {
    await sendWhatsappOutboundMessage({
      accessToken: "token-1",
      phoneNumberId: "phone-1",
      to: "5491100000000",
      content: {
        reply: null,
        attachment: null,
        template: { name: "order_update", language: "es" },
      },
    })

    expect(mocks.sendWhatsappMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: { template: { name: "order_update", language: "es" } },
      })
    )
  })
})

describe("error translation reexported for the route", () => {
  // Cloud API no devuelve `message_id`: si la ruta usara el extractor de
  // Messenger, el wamid se perdería y los `statuses` posteriores no
  // encontrarían la fila.
  it("reads the wamid out of messages[0].id", () => {
    expect(extractWhatsappMessageId(accepted.data)).toBe("wamid.HBg1")
    expect(extractWhatsappMessageId({ message_id: "mid-1" })).toBeNull()
  })

  // El 131053 es el gemelo del 100/2018047 de Messenger: Meta no pudo bajar la
  // media del origen del cliente. Lleva el mismo código estable porque la
  // acción del cliente es idéntica.
  it("gives media download failures a stable code", () => {
    expect(explainWhatsappError({ error: { code: 131053 } })).toMatchObject({
      code: "attachment_fetch_failed",
    })
  })

  // La ventana cerrada del lado de Meta sigue teniendo traducción aunque la
  // ruta la corte antes: puede cerrarse entre nuestro chequeo y la llamada.
  it("still translates Meta's own closed-window rejection", () => {
    expect(
      explainWhatsappError({ error: { code: 131047 } })?.message
    ).toContain("24-hour customer service window")
  })
})
