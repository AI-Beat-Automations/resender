import { describe, expect, it } from "vitest"

import { parseTemplateSendInput } from "./template-send-request"

const target = { pageId: "phone-1", recipientId: "5491100000000" }

describe("parseTemplateSendInput", () => {
  it("valida y recorta name y language", () => {
    expect(
      parseTemplateSendInput({
        ...target,
        template: { name: " hello_world ", language: " en_US " },
      })
    ).toEqual({
      ok: true,
      value: {
        target: {
          kind: "contact",
          pageId: "phone-1",
          recipientId: "5491100000000",
          conversationId: undefined,
        },
        template: { name: "hello_world", language: "en_US" },
      },
    })
  })

  // Los `components` viajan tal cual: el conteo de parámetros lo valida Meta.
  it("pasa los components sin tocarlos", () => {
    const components = [
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
    ]
    const result = parseTemplateSendInput({
      conversationId: "conv-1",
      template: { name: "pedido_listo", language: "es_MX", components },
    })
    expect(result).toEqual({
      ok: true,
      value: {
        target: { kind: "conversation", conversationId: "conv-1" },
        template: { name: "pedido_listo", language: "es_MX", components },
      },
    })
  })

  it("devuelve los errores de destino de parseSendTarget", () => {
    expect(
      parseTemplateSendInput({
        template: { name: "hello_world", language: "en_US" },
      })
    ).toMatchObject({ ok: false, code: "send_destination_missing" })
    expect(
      parseTemplateSendInput({
        pageId: "phone-1",
        template: { name: "hello_world", language: "en_US" },
      })
    ).toMatchObject({ ok: false, code: "send_destination_incomplete" })
  })

  it("exige el objeto template", () => {
    for (const template of [undefined, null, "hello_world", []]) {
      expect(parseTemplateSendInput({ ...target, template })).toMatchObject({
        ok: false,
        code: "template_missing",
      })
    }
  })

  it("exige template.name no vacío", () => {
    for (const name of [undefined, "", "   ", 42]) {
      expect(
        parseTemplateSendInput({
          ...target,
          template: { name, language: "en_US" },
        })
      ).toMatchObject({ ok: false, code: "template_name_missing" })
    }
  })

  it("exige template.language no vacío", () => {
    for (const language of [undefined, "", "   ", { code: "en_US" }]) {
      expect(
        parseTemplateSendInput({
          ...target,
          template: { name: "hello_world", language },
        })
      ).toMatchObject({ ok: false, code: "template_language_missing" })
    }
  })

  it("rechaza components que no son un array", () => {
    for (const components of [null, {}, "body"]) {
      expect(
        parseTemplateSendInput({
          ...target,
          template: { name: "hello_world", language: "en_US", components },
        })
      ).toMatchObject({ ok: false, code: "template_components_invalid" })
    }
  })
})
