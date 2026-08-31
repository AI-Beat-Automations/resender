import { describe, expect, it } from "vitest"

import {
  buildWhatsappTemplateComponents,
  listWhatsappTemplateVariables,
} from "./template-form"

describe("variables del cuerpo de una plantilla", () => {
  it("no encuentra ninguna en un cuerpo sin marcadores", () => {
    expect(listWhatsappTemplateVariables("Tu pedido ya salió.")).toEqual([])
  })

  it("cuenta una sola vez la variable repetida", () => {
    // Repetirla no pide un ejemplo más: es el mismo valor en dos sitios.
    expect(
      listWhatsappTemplateVariables("Hola {{1}}, gracias {{1}} por tu compra.")
    ).toEqual(["1"])
  })

  it("las devuelve por número y no por orden de aparición", () => {
    // La clave de toda la entrega del editor: `example.body_text` es posicional,
    // así que si esto ordenara por aparición el formulario pediría el ejemplo de
    // `{{2}}` en la casilla de `{{1}}`, Meta aprobaría la plantilla igual —la
    // forma es válida— y el cruce sólo se vería en el mensaje que recibe el
    // contacto.
    expect(
      listWhatsappTemplateVariables("Tu pedido {{2}} ya salió, {{1}}.")
    ).toEqual(["1", "2"])
  })

  it("tolera los espacios de dentro del marcador", () => {
    expect(listWhatsappTemplateVariables("Hola {{ 1 }}")).toEqual(["1"])
  })

  it("no confunde una variable nombrada con una posicional", () => {
    // Las nombradas son otro formato, con su propio campo de ejemplos, y este
    // editor no las modela: leerlas como posicionales pediría ejemplos que no
    // corresponden.
    expect(listWhatsappTemplateVariables("Hola {{customer_name}}")).toEqual([])
  })
})

describe("componentes que el editor manda a Meta", () => {
  it("arma sólo el cuerpo cuando no hay pie", () => {
    expect(
      buildWhatsappTemplateComponents({
        body: "Tu pedido ya salió.",
        footer: "",
        examples: [],
      })
    ).toEqual([{ type: "BODY", text: "Tu pedido ya salió." }])
  })

  it("agrega el pie cuando lo hay", () => {
    expect(
      buildWhatsappTemplateComponents({
        body: "Tu pedido ya salió.",
        footer: "Resender",
        examples: [],
      })
    ).toEqual([
      { type: "BODY", text: "Tu pedido ya salió." },
      { type: "FOOTER", text: "Resender" },
    ])
  })

  it("anida los ejemplos como array de arrays", () => {
    // Mandarlo plano —`body_text: ["Ana"]`— es el error de forma más común del
    // endpoint, y el que hace que Meta rechace sin revisar.
    expect(
      buildWhatsappTemplateComponents({
        body: "Hola {{1}}, tu pedido {{2}} ya salió.",
        footer: "",
        examples: ["Ana", "A-1002"],
      })
    ).toEqual([
      {
        type: "BODY",
        text: "Hola {{1}}, tu pedido {{2}} ya salió.",
        example: { body_text: [["Ana", "A-1002"]] },
      },
    ])
  })

  it("descarta el ejemplo que quedó huérfano al borrar su variable", () => {
    // El formulario es vivo: se escriben dos variables, se completan sus dos
    // ejemplos y después se borra una del texto. El ejemplo de más sería un
    // rechazo de forma de Meta por un campo que el usuario ya no ve.
    const components = buildWhatsappTemplateComponents({
      body: "Hola {{1}}, tu pedido ya salió.",
      footer: "",
      examples: ["Ana", "A-1002"],
    })

    expect(components[0]).toEqual({
      type: "BODY",
      text: "Hola {{1}}, tu pedido ya salió.",
      example: { body_text: [["Ana"]] },
    })
  })

  it("no inventa un ejemplo cuando falta: manda de menos y que lo rechace el parser", () => {
    // `parseWhatsappTemplateDraft` compara cuántos ejemplos hay contra cuántas
    // variables tiene el cuerpo, así que un hueco se convierte en un rechazo con
    // nombre. Rellenarlo haría que Meta revise la plantilla con un valor que
    // nadie escribió.
    const components = buildWhatsappTemplateComponents({
      body: "Hola {{1}}, tu pedido {{2}} ya salió.",
      footer: "",
      examples: ["", "A-1002"],
    })

    expect(components[0]).toEqual({
      type: "BODY",
      text: "Hola {{1}}, tu pedido {{2}} ya salió.",
      example: { body_text: [["A-1002"]] },
    })
  })

  it("omite el ejemplo entero en una plantilla sin variables", () => {
    // Un `body_text` vacío es un error de forma, no un campo de más.
    const [body] = buildWhatsappTemplateComponents({
      body: "Tu pedido ya salió.",
      footer: "",
      examples: ["Ana"],
    })

    expect(body).not.toHaveProperty("example")
  })

  it("recorta los espacios del cuerpo, del pie y de los ejemplos", () => {
    expect(
      buildWhatsappTemplateComponents({
        body: "  Hola {{1}}  ",
        footer: "  Resender  ",
        examples: ["  Ana  "],
      })
    ).toEqual([
      { type: "BODY", text: "Hola {{1}}", example: { body_text: [["Ana"]] } },
      { type: "FOOTER", text: "Resender" },
    ])
  })
})
