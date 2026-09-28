import { describe, expect, it } from "vitest"

import { formatTemplateLabel, toTemplateDisplay } from "./template-display"

const COPY = {
  label: "📋 {name} ({language})",
  labelNoLanguage: "📋 {name}",
  fallbackName: "template",
}

const bodyParams = (...texts: string[]) => [
  {
    type: "body",
    parameters: texts.map((text) => ({ type: "text", text })),
  },
]

describe("toTemplateDisplay", () => {
  it("sin body: nombre, idioma y los valores del body en orden", () => {
    const display = toTemplateDisplay({
      name: "order_update",
      language: "es",
      components: [
        { type: "header", parameters: [{ type: "text", text: "cabecera" }] },
        ...bodyParams("Juan", "#1234"),
      ],
    })

    expect(display).toEqual({
      name: "order_update",
      language: "es",
      text: null,
      params: ["Juan", "#1234"],
    })
    expect(formatTemplateLabel(display!, COPY)).toBe(
      "📋 order_update (es) · Juan · #1234"
    )
  })

  it("con body y todos los parámetros: reemplaza de forma posicional", () => {
    const display = toTemplateDisplay({
      name: "order_update",
      language: "es",
      body: "Hola {{1}}, tu pedido {{2}} salió. Gracias, {{1}}.",
      components: bodyParams("Juan", "#1234"),
    })

    expect(display?.text).toBe(
      "Hola Juan, tu pedido #1234 salió. Gracias, Juan."
    )
  })

  it("con menos parámetros de los que pide el cuerpo: el marcador queda visible", () => {
    const display = toTemplateDisplay({
      name: "order_update",
      language: "es",
      body: "Hola {{1}}, tu pedido {{2}} salió.",
      components: bodyParams("Juan"),
    })

    expect(display?.text).toBe("Hola Juan, tu pedido {{2}} salió.")
  })

  it("no corre la posición cuando un parámetro no es de texto", () => {
    const display = toTemplateDisplay({
      name: "invoice",
      language: "en_US",
      body: "Total {{1}} due {{2}}",
      components: [
        {
          type: "BODY",
          parameters: [
            { type: "image", image: { link: "https://x" } },
            { type: "date_time", date_time: { fallback_value: "May 1" } },
          ],
        },
      ],
    })

    expect(display?.text).toBe("Total {{1}} due May 1")
    expect(display?.params).toEqual(["May 1"])
  })

  it("sin components: etiqueta con nombre e idioma solos", () => {
    const display = toTemplateDisplay({
      name: "hello_world",
      language: "en_US",
    })

    expect(display).toEqual({
      name: "hello_world",
      language: "en_US",
      text: null,
      params: [],
    })
    expect(formatTemplateLabel(display!, COPY)).toBe("📋 hello_world (en_US)")
  })

  it("con body y sin components: el cuerpo tal cual", () => {
    expect(
      toTemplateDisplay({ name: "x", language: "es", body: "Hola {{1}}" })?.text
    ).toBe("Hola {{1}}")
  })

  it("tolera un template_meta malformado sin tirar error", () => {
    expect(toTemplateDisplay(null)).toBeNull()
    expect(toTemplateDisplay("order_update")).toBeNull()
    expect(toTemplateDisplay([1, 2])).toBeNull()

    const display = toTemplateDisplay({
      name: 42,
      language: null,
      body: { not: "a string" },
      components: [null, "body", { type: "body", parameters: "Juan" }],
    })
    expect(display).toEqual({ name: "", language: "", text: null, params: [] })
    expect(formatTemplateLabel(display!, COPY)).toBe("📋 template")

    expect(
      toTemplateDisplay({
        name: "x",
        components: [
          { type: "body", parameters: [null, { text: 7 }, { text: "ok" }] },
        ],
      })?.params
    ).toEqual(["ok"])
  })
})
