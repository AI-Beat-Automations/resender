import type { WhatsappTemplateAdminFailure } from "@/lib/meta/whatsapp-template-client"
import { toTemplateDisplay } from "@/lib/messages/template-display"

import type { WhatsappTemplateStatus } from "./template-store"

// Las reglas del editor de [Plantilla]s de la consola (issue #196). Puro: el
// formulario, la server action y los diálogos de confirmación deciden con
// esto, y Vitest lo prueba sin montar componentes.
//
// Lo que **no** vive acá es la validación del borrador: es
// `validateTemplateDraft` / `validateTemplateContent` (`template-draft.ts`),
// la misma que usa la API pública. Este módulo solo arma su entrada desde el
// formulario y traduce sus códigos.

// Solo las variables bien escritas: `{{1}}`, `{{2}}`. Una mal escrita
// (`{{nombre}}`) no abre un campo de ejemplo; la rechaza el validador.
const VARIABLE_PATTERN = /\{\{([1-9]\d*)\}\}/g

/**
 * Los números de variable del cuerpo, sin repetir y en orden: un campo de
 * ejemplo por cada uno. Un hueco (`{{1}}` y `{{3}}`) se muestra tal cual y lo
 * rechaza el validador con su mensaje.
 */
export function detectTemplateVariables(text: string): number[] {
  const seen = new Set<number>()
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    seen.add(Number(match[1]))
  }
  return [...seen].sort((a, b) => a - b)
}

/** El nombre del campo de ejemplo de `{{n}}` en el `FormData`. */
export function exampleFieldName(variable: number): string {
  return `example_${variable}`
}

/**
 * El cuerpo como lo va a ver el contacto, con cada `{{n}}` reemplazado por su
 * ejemplo. Reusa el reemplazo del Inbox (`toTemplateDisplay`): una variable
 * sin ejemplo queda visible como `{{n}}`.
 */
export function buildTemplatePreview(
  text: string,
  examples: Record<number, string>
): string {
  const variables = detectTemplateVariables(text)
  const count = variables.length > 0 ? Math.max(...variables) : 0
  const parameters = Array.from({ length: count }, (_, index) => {
    const example = examples[index + 1]?.trim()
    return example ? { type: "text", text: example } : { type: "text" }
  })
  const display = toTemplateDisplay({
    body: text,
    components: [{ type: "body", parameters }],
  })
  return display?.text ?? text
}

/**
 * La entrada de `validateTemplateContent` (y de `validateTemplateDraft` al
 * crear) desde el formulario: los ejemplos van en el orden de las variables
 * detectadas, uno por cada una.
 */
export function readTemplateContentForm(formData: FormData): {
  body: { text: string; examples: string[] }
  footer: string
} {
  const text = readField(formData, "body")
  const examples = detectTemplateVariables(text).map((variable) =>
    readField(formData, exampleFieldName(variable))
  )
  return { body: { text, examples }, footer: readField(formData, "footer") }
}

export function readTemplateDraftForm(formData: FormData) {
  return {
    name: readField(formData, "name"),
    language: readField(formData, "language"),
    category: readField(formData, "category"),
    ...readTemplateContentForm(formData),
  }
}

/**
 * Qué avisar antes de editar o borrar. Editar solo pide confirmación si hay
 * algo que avisar: una `APPROVED` vuelve a revisión, o la usaron otros
 * números. Borrar siempre confirma (solo ese idioma, nombre bloqueado 30
 * días). El conteo de otros números informa, no bloquea.
 */
export type TemplateConfirmation =
  | { kind: "edit"; reviewWarning: boolean; usedByOtherNumbers: number }
  | { kind: "delete"; usedByOtherNumbers: number }

export function templateConfirmation(
  action: "edit" | "delete",
  template: { status: WhatsappTemplateStatus; usedByOtherNumbers: number }
): TemplateConfirmation | null {
  const usedByOtherNumbers = Math.max(0, template.usedByOtherNumbers)
  if (action === "delete") return { kind: "delete", usedByOtherNumbers }

  const reviewWarning = template.status === "APPROVED"
  if (!reviewWarning && usedByOtherNumbers === 0) return null
  return { kind: "edit", reviewWarning, usedByOtherNumbers }
}

/**
 * La clave del diccionario (`t.templates.metaErrors`) para un rechazo de Meta,
 * según el mismo catálogo que traduce la API (`explainWhatsappTemplateAdminError`).
 * Null si Meta no documenta el código: la UI muestra el mensaje de Meta tal
 * cual, que es lo único que hay.
 */
export type TemplateMetaErrorKey =
  | "tokenExpired"
  | "limitReached"
  | "underReview"
  | "fieldTooLong"
  | "bodyFormat"
  | "footerFormat"
  | "tooManyVariables"
  | "variableAtEdge"

export function templateMetaErrorKey(
  failure: Pick<
    WhatsappTemplateAdminFailure,
    "metaErrorCode" | "metaErrorSubcode"
  >
): TemplateMetaErrorKey | null {
  if (failure.metaErrorCode === 190) return "tokenExpired"
  switch (failure.metaErrorSubcode) {
    case 2388019:
      return "limitReached"
    case 2388039:
      return "underReview"
    case 2388040:
      return "fieldTooLong"
    case 2388072:
      return "bodyFormat"
    case 2388073:
      return "footerFormat"
    case 2388293:
      return "tooManyVariables"
    case 2388299:
      return "variableAtEdge"
    default:
      return null
  }
}

function readField(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}
