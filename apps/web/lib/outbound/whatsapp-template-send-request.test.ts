import { describe, expect, it } from "vitest"

import { parseWhatsappTemplateSendInput } from "./whatsapp-template-send-request"

const valid = {
  pageId: "phone-1",
  recipientId: "5491100000000",
  template: { name: "order_update", language: "es" },
}

describe("parseWhatsappTemplateSendInput", () => {
  it("validates and trims the whole payload", () => {
    expect(
      parseWhatsappTemplateSendInput({
        pageId: " phone-1 ",
        recipientId: " 5491100000000 ",
        conversationId: " conv-1 ",
        template: { name: " order_update ", language: " es_AR " },
      })
    ).toEqual({
      ok: true,
      value: {
        pageId: "phone-1",
        recipientId: "5491100000000",
        conversationId: "conv-1",
        template: { name: "order_update", language: "es_AR" },
      },
    })
  })

  it("rejects a body that is not an object", () => {
    for (const body of [null, undefined, "texto", 7, []]) {
      expect(parseWhatsappTemplateSendInput(body)).toMatchObject({
        ok: false,
        code: "body_invalid",
      })
    }
  })

  // Los mismos textos que el parser neutral, para que quien ya integra
  // `/whatsapp/send` no tenga que aprender un segundo vocabulario.
  it("reports the destination fields with stable codes", () => {
    expect(parseWhatsappTemplateSendInput({ ...valid, pageId: "  " })).toEqual({
      ok: false,
      code: "page_id_missing",
      error: "missing pageId",
    })
    expect(
      parseWhatsappTemplateSendInput({ ...valid, recipientId: undefined })
    ).toEqual({
      ok: false,
      code: "recipient_id_missing",
      error: "missing recipientId",
    })
    expect(
      parseWhatsappTemplateSendInput({ ...valid, conversationId: "" })
    ).toEqual({
      ok: false,
      code: "conversation_id_invalid",
      error: "invalid conversationId",
    })
  })

  it("treats an absent conversationId as optional", () => {
    const result = parseWhatsappTemplateSendInput(valid)

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("unreachable")
    expect(result.value.conversationId).toBeUndefined()
  })

  it("requires the template object itself", () => {
    expect(
      parseWhatsappTemplateSendInput({
        pageId: "phone-1",
        recipientId: "5491100000000",
      })
    ).toMatchObject({ ok: false, code: "template_missing" })
    // Una lista no es un objeto de plantilla, aunque `typeof` diga que sí.
    expect(
      parseWhatsappTemplateSendInput({ ...valid, template: [] })
    ).toMatchObject({ ok: false, code: "template_missing" })
  })

  it("requires the name", () => {
    expect(
      parseWhatsappTemplateSendInput({
        ...valid,
        template: { language: "es" },
      })
    ).toMatchObject({ ok: false, code: "template_name_missing" })
  })

  // La identidad de una plantilla es `(nombre, idioma)`: sin idioma no hay
  // plantilla que enviar, y adivinar uno mandaría otra distinta de la pedida.
  it("requires the language and never defaults it", () => {
    expect(
      parseWhatsappTemplateSendInput({
        ...valid,
        template: { name: "order_update" },
      })
    ).toMatchObject({ ok: false, code: "template_language_missing" })
  })

  // El nombre y el idioma pasan tal cual: validar su forma sería adivinar
  // reglas de Meta y arriesgarse a negar un envío perfectamente válido.
  it("does not police the shape of name or language", () => {
    const result = parseWhatsappTemplateSendInput({
      ...valid,
      template: { name: "Order Update!", language: "zz_ZZ" },
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("unreachable")
    expect(result.value.template).toEqual({
      name: "Order Update!",
      language: "zz_ZZ",
    })
  })

  // **El punto entero del parser.** No se valida el conteo de parámetros ni la
  // forma de cada componente: sólo que sea una lista. Un falso rechazo nuestro
  // es peor que uno de Meta, porque contra el nuestro el cliente no puede hacer
  // nada.
  it("passes components through without validating them", () => {
    const components = [
      { type: "body", parameters: [{ type: "text", text: "ARG-1" }] },
      { type: "algo_que_no_conocemos", loQueSea: 42 },
    ]

    const result = parseWhatsappTemplateSendInput({
      ...valid,
      template: { name: "order_update", language: "es", components },
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("unreachable")
    expect(result.value.template.components).toEqual(components)
  })

  it("rejects components that are not a list", () => {
    expect(
      parseWhatsappTemplateSendInput({
        ...valid,
        template: {
          name: "order_update",
          language: "es",
          components: { type: "body" },
        },
      })
    ).toMatchObject({ ok: false, code: "template_components_invalid" })
  })

  // Una plantilla sin variables no lleva el campo. `[]` y `null` significan lo
  // mismo que no mandarlo, y ninguno de los dos viaja a Meta.
  it("drops empty or null components", () => {
    for (const components of [[], null, undefined]) {
      const result = parseWhatsappTemplateSendInput({
        ...valid,
        template: { name: "order_update", language: "es", components },
      })

      expect(result).toMatchObject({ ok: true })
      if (!result.ok) throw new Error("unreachable")
      expect(result.value.template).toEqual({
        name: "order_update",
        language: "es",
      })
      expect("components" in result.value.template).toBe(false)
    }
  })
})
