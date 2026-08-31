import { fmt, type AppDict } from "@/content/i18n/app"

// Cómo se lee en el Inbox un envío de [Plantilla] (ADR 0014).
//
// Un envío de plantilla deja la fila con `text = ''`, sin adjunto y con todo el
// contenido en `messages.template_meta` (migración 0018). Sin este módulo esa
// fila se pinta como **una burbuja en blanco**, que es justo lo que el producto
// no puede permitirse: quien abre el hilo tiene que ver qué se le mandó al
// contacto, y en un envío de plantilla eso es lo único que hay.
//
// La regla vive acá y no en el `.tsx` por el mismo motivo que la del adjunto en
// `message-media.ts`: Vitest corre con `include` `**/*.{test,spec}.ts` y los
// componentes no se testean. Lo que la burbuja decide, se decide en un módulo
// puro; el componente solo traduce a markup lo que ya viene resuelto.
//
// ## Esto no es sustitución de variables, y la diferencia importa
//
// El ticket habla de «sustitución de variables» y en el papel eso sería tomar el
// cuerpo aprobado —`Hola {{1}}, tu pedido {{2}} ya salió`— y meterle los valores
// enviados. **No se puede, y no es un descuido:**
//
// - `template_meta` guarda los `components` **de ese envío**, es decir los
//   parámetros, no el cuerpo. Es lo correcto: es lo que el contacto recibió.
// - El espejo del catálogo **no guarda los `components` de la plantilla**
//   (ADR 0014): Meta es el dueño, el contenido no se resincroniza y solo el
//   `status` se mantiene fresco.
// - Y aunque lo guardara, tampoco serviría: una edición devuelve la plantilla a
//   revisión y no se re-espeja, así que reconstruir la burbuja desde el catálogo
//   mostraría lo que la plantilla dice **hoy** y no lo que se envió aquel día.
//   Un texto plausible y falso es peor que un texto parcial y cierto.
//
// Así que lo que se muestra es lo único que consta: **la identidad de la
// plantilla —nombre e idioma, que es el identificador que usa Meta— y los
// valores que viajaron, en el orden en que viajaron.** Para el caso normal —un
// solo `body`— ese orden es el de los marcadores (`{{1}}`, `{{2}}`, …), así que
// quien lea el hilo reconoce los datos aunque le falte la frase que los enlaza.
//
// **Qué haría falta para que fuera sustitución de verdad:** persistir el cuerpo
// aprobado dentro de `template_meta` en el mismo `insert` del envío —el único
// instante en que se puede afirmar contra qué versión se envió— y sustituir acá
// los `{{n}}`. Es una decisión de esquema y de la ruta de envío, no de la vista,
// y por eso queda escrita y no hecha.
//
// ## Menos parámetros de los que el cuerpo pide
//
// Sin el cuerpo no hay forma de detectarlo: no sabemos cuántos marcadores tenía.
// Este módulo pinta lo que se envió y **nunca inventa huecos**. Ese envío además
// no llega vivo al hilo —Meta lo rechaza con 132000 y la fila queda `failed`—,
// así que la burbuja muestra lo que se intentó, que es lo que uno quiere ver
// cuando está averiguando por qué falló.
//
// ## Nada de esto tira
//
// `template_meta` es `jsonb` y entra como `unknown`. Toda forma que no
// reconocemos degrada a «menos valores», nunca a una excepción: una burbuja rota
// es peor que una burbuja parcial, y es la misma regla que siguen las coerciones
// de los parsers del webhook (`lib/inbound/whatsapp-parsers/coerce.ts`). No se
// importan de ahí a propósito: ese módulo es del webhook entrante, y atarle la
// vista del Inbox lo convertiría en una dependencia común sin que nadie lo haya
// decidido.

export type TemplateDisplay = {
  /** `plantilla · order_update · es_AR`, ya interpolado y listo para pintar. */
  label: string
  /**
   * Los valores que se enviaron, en el orden en que viajaron a Meta. Vacío es
   * un resultado legítimo: una plantilla sin variables no lleva `components`.
   */
  values: string[]
}

/**
 * Qué pinta la burbuja de un envío de plantilla, o `null` si esta fila no es
 * uno —que es el caso de todos los mensajes de Messenger, Instagram y del
 * WhatsApp libre—.
 *
 * Devuelve algo aunque el jsonb esté incompleto: mientras haya un objeto, la
 * burbuja se pinta con lo que se pueda leer. El `null` significa «esto no es una
 * plantilla», no «no supe leerla».
 */
export function toTemplateDisplay(
  templateMeta: unknown,
  t: AppDict
): TemplateDisplay | null {
  const meta = asRecord(templateMeta)
  if (!meta) return null

  const name = asText(meta.name) ?? t.log.templateUnnamed
  const language = asText(meta.language)

  return {
    label: language
      ? fmt(t.log.templateLabel, { name, language })
      : fmt(t.log.templateLabelNoLanguage, { name }),
    values: templateValues(meta.components),
  }
}

/**
 * Los valores de todos los `components`, aplanados y en orden de aparición.
 *
 * No se filtra por `type` del componente —`body`, `header`, `footer`,
 * `button`—. Aplanar pierde de qué parte de la plantilla salió cada valor, y se
 * acepta: el editor v1 solo hace `body` con variables y `footer` (que no lleva
 * parámetros), así que en la práctica el orden plano **es** el de los
 * marcadores. Filtrar por una lista de tipos conocidos, en cambio, haría
 * desaparecer en silencio los valores de un componente que Meta agregue después.
 */
function templateValues(components: unknown): string[] {
  const values: string[] = []

  for (const raw of asArray(components)) {
    const component = asRecord(raw)
    if (!component) continue
    for (const parameter of asArray(component.parameters)) {
      const value = parameterValue(parameter)
      if (value !== null) values.push(value)
    }
  }

  return values
}

/**
 * El valor legible de un parámetro suelto.
 *
 * El caso normal es `{ type: "text", text: "A-1024" }`, con o sin
 * `parameter_name` si el cliente usa parámetros nombrados. Los tipos con forma
 * propia —`currency`, `date_time`— no traen `text` sino un objeto homónimo con
 * un `fallback_value`, que es **la cadena que Meta misma le muestra al contacto**
 * cuando no puede localizar el valor: es exactamente lo que la burbuja quiere.
 *
 * Lo que no encaja en ninguna de las dos formas se descarta sin ruido. Es lo
 * correcto para los parámetros de media de un `header` (un `link` firmado no le
 * dice nada a quien lee el hilo) y para el `payload` de un botón, que es un dato
 * del integrador y no algo que el contacto haya visto.
 */
function parameterValue(raw: unknown): string | null {
  const parameter = asRecord(raw)
  if (!parameter) return null

  const text = asText(parameter.text)
  if (text) return text

  const type = asText(parameter.type)
  const nested = type ? asRecord(parameter[type]) : null
  return asText(nested?.fallback_value)
}

// Coerciones locales. Todo lo que no tiene la forma esperada vuelve como null y
// el que llama decide qué hacer; nada de esto lanza.

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** String no vacío, ya recortado. El vacío se trata como ausencia. */
function asText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}
