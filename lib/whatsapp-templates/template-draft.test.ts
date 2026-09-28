import { describe, expect, it } from "vitest"

import {
  buildTemplateComponents,
  canManageTemplate,
  validateTemplateContent,
  validateTemplateDraft,
} from "./template-draft"

const draft = (overrides: Record<string, unknown> = {}) => ({
  name: "aviso_de_cita",
  language: "es_MX",
  category: "utility",
  body: {
    text: "Hola {{1}}, tu cita es el {{2}}.",
    examples: ["Ana", "lunes"],
  },
  ...overrides,
})

describe("validateTemplateDraft", () => {
  it("acepta un borrador válido y normaliza la categoría", () => {
    const result = validateTemplateDraft(draft({ category: "MARKETING" }))

    expect(result).toEqual({
      ok: true,
      value: {
        name: "aviso_de_cita",
        language: "es_MX",
        category: "marketing",
        body: {
          text: "Hola {{1}}, tu cita es el {{2}}.",
          examples: ["Ana", "lunes"],
        },
        footer: null,
      },
    })
  })

  it("acepta un cuerpo sin variables y sin ejemplos", () => {
    const result = validateTemplateDraft(
      draft({ body: { text: "Gracias por tu compra." } })
    )

    expect(result).toMatchObject({
      ok: true,
      value: { body: { text: "Gracias por tu compra.", examples: [] } },
    })
  })

  it("una variable repetida cuenta una vez", () => {
    const result = validateTemplateDraft(
      draft({ body: { text: "Hola {{1}}, sí, {{1}}.", examples: ["Ana"] } })
    )

    expect(result.ok).toBe(true)
  })

  it.each([
    ["mayúsculas", "Aviso"],
    ["espacios", "aviso de cita"],
    ["guiones", "aviso-cita"],
    ["vacío", ""],
    ["más de 512", "a".repeat(513)],
  ])("rechaza un nombre inválido: %s", (_case, name) => {
    expect(validateTemplateDraft(draft({ name }))).toMatchObject({
      ok: false,
      code: "template_name_invalid",
    })
  })

  it("acepta un nombre de 512", () => {
    expect(validateTemplateDraft(draft({ name: "a".repeat(512) })).ok).toBe(
      true
    )
  })

  it("rechaza un idioma que no es un código", () => {
    expect(validateTemplateDraft(draft({ language: "español" }))).toMatchObject(
      {
        ok: false,
        code: "template_language_invalid",
      }
    )
  })

  it.each(["authentication", "otra", ""])(
    "rechaza la categoría no permitida %j",
    (category) => {
      expect(validateTemplateDraft(draft({ category }))).toMatchObject({
        ok: false,
        code: "template_category_invalid",
      })
    }
  )

  it("rechaza variables salteadas", () => {
    const result = validateTemplateDraft(
      draft({ body: { text: "Hola {{1}}, el {{3}}.", examples: ["a", "b"] } })
    )

    expect(result).toMatchObject({
      ok: false,
      code: "template_variables_not_sequential",
    })
  })

  it("rechaza variables que no empiezan en {{1}}", () => {
    const result = validateTemplateDraft(
      draft({ body: { text: "Hola {{2}}.", examples: ["a"] } })
    )

    expect(result).toMatchObject({
      ok: false,
      code: "template_variables_not_sequential",
    })
  })

  it("rechaza una variable que no es un número", () => {
    const result = validateTemplateDraft(
      draft({ body: { text: "Hola {{nombre}}.", examples: ["a"] } })
    )

    expect(result).toMatchObject({
      ok: false,
      code: "template_variable_invalid",
    })
  })

  it("rechaza una variable al inicio o al final del cuerpo", () => {
    for (const text of ["{{1}} te espera.", "Te espera {{1}}"]) {
      expect(
        validateTemplateDraft(draft({ body: { text, examples: ["Ana"] } }))
      ).toMatchObject({ ok: false, code: "template_variable_at_edge" })
    }
  })

  it("rechaza ejemplos faltantes", () => {
    const result = validateTemplateDraft(
      draft({ body: { text: "Hola {{1}}, el {{2}}.", examples: ["Ana"] } })
    )

    expect(result).toMatchObject({
      ok: false,
      code: "template_examples_mismatch",
    })
  })

  it("rechaza un ejemplo vacío", () => {
    const result = validateTemplateDraft(
      draft({ body: { text: "Hola {{1}}, el {{2}}.", examples: ["Ana", " "] } })
    )

    expect(result).toMatchObject({ ok: false, code: "template_example_empty" })
  })

  it("rechaza un cuerpo ausente", () => {
    expect(validateTemplateDraft(draft({ body: undefined }))).toMatchObject({
      ok: false,
      code: "template_body_missing",
    })
  })

  it("footer opcional: vacío es null, con variables o largo se rechaza", () => {
    expect(validateTemplateDraft(draft({ footer: "" }))).toMatchObject({
      ok: true,
      value: { footer: null },
    })
    expect(validateTemplateDraft(draft({ footer: "Clínica" }))).toMatchObject({
      ok: true,
      value: { footer: "Clínica" },
    })
    expect(
      validateTemplateDraft(draft({ footer: "Hola {{1}}" }))
    ).toMatchObject({ ok: false, code: "template_footer_invalid" })
    expect(
      validateTemplateDraft(draft({ footer: "x".repeat(61) }))
    ).toMatchObject({ ok: false, code: "template_footer_invalid" })
  })
})

describe("validateTemplateContent", () => {
  it("valida solo body y footer: el nombre no se edita", () => {
    const result = validateTemplateContent({
      body: { text: "Nuevo {{1}} texto", examples: ["x"] },
      footer: "Pie",
    })

    expect(result).toEqual({
      ok: true,
      value: {
        body: { text: "Nuevo {{1}} texto", examples: ["x"] },
        footer: "Pie",
      },
    })
  })
})

describe("buildTemplateComponents", () => {
  it("BODY con example.body_text y FOOTER", () => {
    expect(
      buildTemplateComponents({
        body: { text: "Hola {{1}}, el {{2}}.", examples: ["Ana", "lunes"] },
        footer: "Clínica",
      })
    ).toEqual([
      {
        type: "BODY",
        text: "Hola {{1}}, el {{2}}.",
        example: { body_text: [["Ana", "lunes"]] },
      },
      { type: "FOOTER", text: "Clínica" },
    ])
  })

  it("sin footer y sin variables: solo BODY, sin example", () => {
    expect(
      buildTemplateComponents({
        body: { text: "Gracias.", examples: [] },
        footer: null,
      })
    ).toEqual([{ type: "BODY", text: "Gracias." }])
  })
})

describe("canManageTemplate", () => {
  const padre = { tenantId: "tenant-1", clientAccountId: null }
  const cliente = { tenantId: "tenant-1", clientAccountId: "client-1" }

  it("la propia del padre la maneja el padre", () => {
    const row = {
      createdByTenantId: "tenant-1",
      createdByClientAccountId: null,
    }
    expect(canManageTemplate(row, padre)).toBe(true)
    expect(canManageTemplate(row, cliente)).toBe(false)
  })

  it("la de un cliente, vista por el padre, es de solo lectura para el padre", () => {
    const row = {
      createdByTenantId: "tenant-1",
      createdByClientAccountId: "client-1",
    }
    expect(canManageTemplate(row, padre)).toBe(false)
    expect(canManageTemplate(row, cliente)).toBe(true)
    expect(
      canManageTemplate(row, {
        tenantId: "tenant-1",
        clientAccountId: "client-2",
      })
    ).toBe(false)
  })

  it("la importada por el sync no es de nadie", () => {
    const row = { createdByTenantId: null, createdByClientAccountId: null }
    expect(canManageTemplate(row, padre)).toBe(false)
    expect(canManageTemplate(row, cliente)).toBe(false)
  })

  it("la de otro tenant de la WABA es ajena", () => {
    const row = {
      createdByTenantId: "tenant-2",
      createdByClientAccountId: null,
    }
    expect(canManageTemplate(row, padre)).toBe(false)
  })
})
