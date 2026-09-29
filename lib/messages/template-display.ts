// Cómo se ve en el Inbox un saliente que fue una [Plantilla] (issue #191).
//
// Un envío de plantilla se persiste con `text = ''` y la plantilla en
// `template_meta` (migración 0031), así que sin esto la burbuja y el renglón
// de la lista quedan vacíos. La regla vive en un `.ts` y no en el componente
// porque Vitest corre en `node` y los `.tsx` no se testean.
//
// `template_meta` es `{ name, language, components, body? }`:
// - con `body` (el cuerpo copiado en cada envío) se muestra el texto con las
//   variables reemplazadas;
// - sin `body` se muestra una etiqueta con nombre, idioma y valores de las
//   variables (`📋 order_update (es) · Juan · #1234`).
//
// El jsonb viene de la base y puede traer cualquier cosa: nada de acá tira
// error, se devuelve lo que se pueda leer.

export type TemplateDisplay = {
  /** `""` si el meta no trae nombre. */
  name: string
  /** `""` si el meta no trae idioma. */
  language: string
  /** El cuerpo con las variables reemplazadas; null si no hay `body`. */
  text: string | null
  /** Los valores de los parámetros del componente `body`, en orden. */
  params: string[]
}

export function toTemplateDisplay(meta: unknown): TemplateDisplay | null {
  const record = asRecord(meta)
  if (!record) return null

  const values = bodyParameterValues(record.components)
  const body = readString(record.body)

  return {
    name: readString(record.name) ?? "",
    language: readString(record.language) ?? "",
    text: body === null ? null : fillPlaceholders(body, values),
    params: values.filter((value): value is string => value !== null),
  }
}

/**
 * La etiqueta sin cuerpo: `📋 order_update (es) · Juan · #1234`. Los patrones
 * vienen del diccionario (`t.inbox.templateLabel*`) con `{name}` y
 * `{language}`; sin idioma se usa el patrón que no lo menciona, y sin nombre
 * el nombre genérico, para que la etiqueta nunca quede vacía.
 */
export function formatTemplateLabel(
  display: TemplateDisplay,
  copy: { label: string; labelNoLanguage: string; fallbackName: string }
): string {
  const name = display.name || copy.fallbackName
  const head = display.language
    ? copy.label.replace("{name}", name).replace("{language}", display.language)
    : copy.labelNoLanguage.replace("{name}", name)
  return [head, ...display.params].join(" · ")
}

// Reemplazo **posicional**: `{{1}}` es el primer parámetro del `body`. Si falta
// el parámetro, el marcador queda visible tal cual: inventar un valor sería
// mostrar un mensaje que el contacto no recibió.
function fillPlaceholders(body: string, values: (string | null)[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (marker, index: string) => {
    const value = values[Number(index) - 1]
    return value ?? marker
  })
}

// Un valor por parámetro, con null donde no hay texto legible, para que el
// reemplazo posicional no se corra cuando un parámetro no es de texto. Moneda
// y fecha traen `fallback_value`, que es lo que Meta muestra si no puede
// localizar: sirve igual para el Inbox.
function bodyParameterValues(components: unknown): (string | null)[] {
  if (!Array.isArray(components)) return []
  const body = components
    .map(asRecord)
    .find((component) => readString(component?.type)?.toLowerCase() === "body")
  if (!body || !Array.isArray(body.parameters)) return []

  return body.parameters.map((parameter) => {
    const record = asRecord(parameter)
    if (!record) return null
    return (
      readString(record.text) ??
      readString(asRecord(record.currency)?.fallback_value) ??
      readString(asRecord(record.date_time)?.fallback_value)
    )
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
