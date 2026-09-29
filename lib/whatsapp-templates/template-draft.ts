// El borrador de una [Plantilla] que Resender crea o edita (issue #194).
// Módulo puro: lo usan la API pública y la UI del ticket 9, y ninguna de las
// dos tiene que llamar a Meta para saber si un borrador es válido.
//
// Editor v1: `body` con variables posicionales `{{1}}…{{n}}` y `footer`
// opcional, en las categorías `utility` y `marketing`. Encabezado con media,
// botones y plantillas `authentication` quedan fuera.
//
// **Un ejemplo por variable.** Meta rechaza automáticamente, sin revisión, una
// plantilla con variables sin `example.body_text`; validarlo acá le ahorra al
// cliente la ida y vuelta.

export const TEMPLATE_DRAFT_CATEGORIES = ["utility", "marketing"] as const

export type TemplateDraftCategory = (typeof TEMPLATE_DRAFT_CATEGORIES)[number]

// Topes de Meta para lo que el editor v1 arma.
export const TEMPLATE_NAME_MAX_CHARS = 512
export const TEMPLATE_BODY_MAX_CHARS = 1024
export const TEMPLATE_FOOTER_MAX_CHARS = 60

// Lo que se puede cambiar de una plantilla que ya existe: el contenido. El
// nombre y el idioma son su identidad en Meta y no se editan.
export type TemplateContent = {
  body: { text: string; examples: string[] }
  footer: string | null
}

export type TemplateDraft = TemplateContent & {
  name: string
  language: string
  category: TemplateDraftCategory
}

export type TemplateDraftErrorCode =
  | "template_name_invalid"
  | "template_language_invalid"
  | "template_category_invalid"
  | "template_body_missing"
  | "template_body_too_long"
  | "template_variable_invalid"
  | "template_variables_not_sequential"
  | "template_variable_at_edge"
  | "template_examples_mismatch"
  | "template_example_empty"
  | "template_footer_invalid"

export type TemplateDraftResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: TemplateDraftErrorCode; error: string }

const NAME_PATTERN = /^[a-z0-9_]+$/
// `en_US`, `es`, `es_MX`, `zh_HK`, `pt_BR`: dos o tres letras y, opcional, la
// variante regional. Meta es quien decide si el código existe.
const LANGUAGE_PATTERN = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/
// Cualquier `{{…}}`: lo que no sea un número es una variable mal escrita, no
// texto literal.
const VARIABLE_PATTERN = /\{\{([^{}]*)\}\}/g
const HAS_VARIABLE = /\{\{[^{}]*\}\}/

/** El borrador completo, para crear. */
export function validateTemplateDraft(
  input: unknown
): TemplateDraftResult<TemplateDraft> {
  const record = asRecord(input) ?? {}

  const name = typeof record.name === "string" ? record.name.trim() : ""
  if (
    !name ||
    name.length > TEMPLATE_NAME_MAX_CHARS ||
    !NAME_PATTERN.test(name)
  ) {
    return fail(
      "template_name_invalid",
      `name must be 1-${TEMPLATE_NAME_MAX_CHARS} characters of lowercase letters, numbers and underscores (for example order_update)`
    )
  }

  const language =
    typeof record.language === "string" ? record.language.trim() : ""
  if (!LANGUAGE_PATTERN.test(language)) {
    return fail(
      "template_language_invalid",
      "language must be a WhatsApp language code (for example en_US or es_MX)"
    )
  }

  const category =
    typeof record.category === "string"
      ? record.category.trim().toLowerCase()
      : ""
  if (!(TEMPLATE_DRAFT_CATEGORIES as readonly string[]).includes(category)) {
    return fail(
      "template_category_invalid",
      `category must be one of: ${TEMPLATE_DRAFT_CATEGORIES.join(", ")}`
    )
  }

  const content = validateTemplateContent(record)
  if (!content.ok) return content

  return {
    ok: true,
    value: {
      name,
      language,
      category: category as TemplateDraftCategory,
      ...content.value,
    },
  }
}

/** Solo el contenido, para editar: `body` y `footer`. */
export function validateTemplateContent(
  input: unknown
): TemplateDraftResult<TemplateContent> {
  const record = asRecord(input) ?? {}
  const body = asRecord(record.body)

  const text = typeof body?.text === "string" ? body.text.trim() : ""
  if (!text) {
    return fail(
      "template_body_missing",
      "missing body: send { text, examples } with one example per {{n}}"
    )
  }
  if (text.length > TEMPLATE_BODY_MAX_CHARS) {
    return fail(
      "template_body_too_long",
      `body.text is longer than ${TEMPLATE_BODY_MAX_CHARS} characters`
    )
  }

  const variables = readVariables(text)
  if (!variables.ok) return variables
  // Meta lo rechaza con 2388299: una variable no puede abrir ni cerrar el
  // cuerpo.
  if (/^\{\{[^{}]*\}\}/.test(text) || /\{\{[^{}]*\}\}$/.test(text)) {
    return fail(
      "template_variable_at_edge",
      "body.text can't start or end with a variable: add some text before and after it"
    )
  }
  const count = variables.value

  const rawExamples = body?.examples ?? []
  if (
    !Array.isArray(rawExamples) ||
    rawExamples.length !== count ||
    rawExamples.some((example) => typeof example !== "string")
  ) {
    return fail(
      "template_examples_mismatch",
      `body.examples must be an array with exactly one example per variable (${count})`
    )
  }
  const examples = (rawExamples as string[]).map((example) => example.trim())
  const empty = examples.findIndex((example) => !example)
  if (empty !== -1) {
    return fail(
      "template_example_empty",
      `body.examples[${empty}] is empty: WhatsApp rejects a template without an example for {{${empty + 1}}}`
    )
  }

  const footer = readFooter(record.footer)
  if (!footer.ok) return footer

  return {
    ok: true,
    value: { body: { text, examples }, footer: footer.value },
  }
}

/**
 * Los `components` que espera Graph: `BODY` con sus ejemplos y, si hay,
 * `FOOTER`. Sin variables no va `example`: Meta lo rechaza vacío.
 */
export function buildTemplateComponents(
  content: TemplateContent
): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: content.body.text,
      ...(content.body.examples.length > 0
        ? { example: { body_text: [content.body.examples] } }
        : {}),
    },
  ]
  if (content.footer) {
    components.push({ type: "FOOTER", text: content.footer })
  }
  return components
}

export type TemplateActor = {
  tenantId: string
  clientAccountId: string | null
}

/**
 * La regla de dueño: solo se edita y borra lo que creó este mismo actor desde
 * Resender. Una importada por el sync (sin dueño), la de un [Cliente] vista
 * por su [Padre] o la de otro tenant de la WABA son de solo lectura, y se
 * editan en WhatsApp Manager.
 */
export function canManageTemplate(
  template: {
    createdByTenantId: string | null
    createdByClientAccountId: string | null
  },
  actor: TemplateActor
): boolean {
  return (
    template.createdByTenantId !== null &&
    template.createdByTenantId === actor.tenantId &&
    template.createdByClientAccountId === actor.clientAccountId
  )
}

// Cuántas variables tiene el cuerpo, si son `{{1}}…{{n}}` sin huecos. Una
// variable se puede repetir; lo que no puede es saltarse un número.
function readVariables(text: string): TemplateDraftResult<number> {
  const seen = new Set<number>()
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const token = match[1] ?? ""
    if (!/^[1-9]\d*$/.test(token)) {
      return fail(
        "template_variable_invalid",
        `{{${token}}} is not a valid variable: use {{1}}, {{2}}, …`
      )
    }
    seen.add(Number(token))
  }

  for (let index = 1; index <= seen.size; index += 1) {
    if (!seen.has(index)) {
      return fail(
        "template_variables_not_sequential",
        `variables must be consecutive starting at {{1}}: {{${index}}} is missing`
      )
    }
  }
  return { ok: true, value: seen.size }
}

function readFooter(value: unknown): TemplateDraftResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  const footer = typeof value === "string" ? value.trim() : null
  if (footer === "") return { ok: true, value: null }
  if (
    footer === null ||
    footer.length > TEMPLATE_FOOTER_MAX_CHARS ||
    HAS_VARIABLE.test(footer)
  ) {
    return fail(
      "template_footer_invalid",
      `footer must be text of up to ${TEMPLATE_FOOTER_MAX_CHARS} characters, without variables`
    )
  }
  return { ok: true, value: footer }
}

function fail(
  code: TemplateDraftErrorCode,
  error: string
): { ok: false; code: TemplateDraftErrorCode; error: string } {
  return { ok: false, code, error }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
