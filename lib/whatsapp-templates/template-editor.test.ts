import { describe, expect, it } from "vitest"

import {
  buildTemplatePreview,
  detectTemplateVariables,
  readTemplateContentForm,
  readTemplateDraftForm,
  templateConfirmation,
  templateMetaErrorKey,
} from "./template-editor"
import {
  validateTemplateContent,
  validateTemplateDraft,
} from "./template-draft"

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe("detectTemplateVariables", () => {
  it("devuelve cada variable una vez y en orden", () => {
    expect(
      detectTemplateVariables("Hola {{2}}, {{1}}. Tu pedido {{2}} llegó.")
    ).toEqual([1, 2])
  })

  it("sin variables no abre campos", () => {
    expect(detectTemplateVariables("Gracias por tu compra.")).toEqual([])
  })

  it("ignora las mal escritas: las rechaza el validador", () => {
    expect(
      detectTemplateVariables("Hola {{nombre}} y {{0}} y {{ 1 }}")
    ).toEqual([])
  })

  it("deja ver el hueco tal cual", () => {
    expect(detectTemplateVariables("A {{1}} B {{3}} C")).toEqual([1, 3])
  })
})

describe("buildTemplatePreview", () => {
  it("reemplaza cada variable por su ejemplo", () => {
    expect(
      buildTemplatePreview("Hola {{1}}, tu pedido {{2}} llegó. {{1}}!", {
        1: "Ana",
        2: "#1234",
      })
    ).toBe("Hola Ana, tu pedido #1234 llegó. Ana!")
  })

  it("una variable sin ejemplo queda visible", () => {
    expect(
      buildTemplatePreview("Hola {{1}}, tu pedido {{2}} llegó.", {
        1: "Ana",
        2: "  ",
      })
    ).toBe("Hola Ana, tu pedido {{2}} llegó.")
  })

  it("sin variables es el texto tal cual", () => {
    expect(buildTemplatePreview("Gracias.", {})).toBe("Gracias.")
  })
})

describe("readTemplateContentForm", () => {
  it("arma un ejemplo por variable detectada y pasa el validador", () => {
    const content = readTemplateContentForm(
      form({
        body: "Hola {{1}}, tu cita es el {{2}}.",
        example_1: "Ana",
        example_2: "lunes",
        example_3: "sobra",
        footer: "Clínica Norte",
      })
    )
    expect(content).toEqual({
      body: {
        text: "Hola {{1}}, tu cita es el {{2}}.",
        examples: ["Ana", "lunes"],
      },
      footer: "Clínica Norte",
    })
    expect(validateTemplateContent(content).ok).toBe(true)
  })

  it("un ejemplo vacío lo rechaza el validador de la API", () => {
    const result = validateTemplateContent(
      readTemplateContentForm(form({ body: "Hola {{1}}, gracias." }))
    )
    expect(result).toMatchObject({ ok: false, code: "template_example_empty" })
  })

  it("el borrador completo trae nombre, idioma y categoría", () => {
    const result = validateTemplateDraft(
      readTemplateDraftForm(
        form({
          name: "aviso_cita",
          language: "es_MX",
          category: "utility",
          body: "Hola {{1}}, gracias.",
          example_1: "Ana",
        })
      )
    )
    expect(result).toEqual({
      ok: true,
      value: {
        name: "aviso_cita",
        language: "es_MX",
        category: "utility",
        body: { text: "Hola {{1}}, gracias.", examples: ["Ana"] },
        footer: null,
      },
    })
  })
})

describe("templateConfirmation", () => {
  it("editar una aprobada avisa que vuelve a revisión", () => {
    expect(
      templateConfirmation("edit", {
        status: "APPROVED",
        usedByOtherNumbers: 0,
      })
    ).toEqual({ kind: "edit", reviewWarning: true, usedByOtherNumbers: 0 })
  })

  it("editar una pendiente que nadie más usó no pide confirmación", () => {
    expect(
      templateConfirmation("edit", { status: "PENDING", usedByOtherNumbers: 0 })
    ).toBeNull()
  })

  it("editar una que usaron otros números lo avisa aunque no esté aprobada", () => {
    expect(
      templateConfirmation("edit", {
        status: "REJECTED",
        usedByOtherNumbers: 2,
      })
    ).toEqual({ kind: "edit", reviewWarning: false, usedByOtherNumbers: 2 })
  })

  it("borrar siempre confirma, con el conteo", () => {
    expect(
      templateConfirmation("delete", {
        status: "PENDING",
        usedByOtherNumbers: 0,
      })
    ).toEqual({ kind: "delete", usedByOtherNumbers: 0 })
    expect(
      templateConfirmation("delete", {
        status: "APPROVED",
        usedByOtherNumbers: 3,
      })
    ).toEqual({ kind: "delete", usedByOtherNumbers: 3 })
  })
})

describe("templateMetaErrorKey", () => {
  it("traduce los subcódigos que documenta Meta", () => {
    expect(
      templateMetaErrorKey({ metaErrorCode: 100, metaErrorSubcode: 2388019 })
    ).toBe("limitReached")
    expect(
      templateMetaErrorKey({ metaErrorCode: 100, metaErrorSubcode: 2388299 })
    ).toBe("variableAtEdge")
  })

  it("el token vencido gana sobre el subcódigo", () => {
    expect(
      templateMetaErrorKey({ metaErrorCode: 190, metaErrorSubcode: 2388019 })
    ).toBe("tokenExpired")
  })

  it("lo no documentado no se traduce", () => {
    expect(
      templateMetaErrorKey({ metaErrorCode: 100, metaErrorSubcode: 2388024 })
    ).toBeNull()
    expect(
      templateMetaErrorKey({ metaErrorCode: null, metaErrorSubcode: null })
    ).toBeNull()
  })
})
