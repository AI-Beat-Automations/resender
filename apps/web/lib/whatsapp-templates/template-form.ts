import type { WhatsappTemplateComponent } from "@/lib/meta/whatsapp-template-client"

// Las reglas del **editor** de plantillas de la consola: qué variables tiene un
// cuerpo, qué ejemplo le toca a cada una, y cómo se arma con eso el array de
// `components` que Meta espera.
//
// **Por qué es un módulo y no está dentro del `.tsx`.** Vitest corre en entorno
// `node` y el `include` es `**/*.{test,spec}.ts`: los componentes no se
// testean, así que toda regla que valga la pena verificar tiene que estar de
// este lado del borde. Es el mismo reparto que ya usan `lib/messages/display.ts`
// y `features/connect-whatsapp/`: la pantalla dibuja, el módulo decide.
//
// **Lo que este módulo no hace: validar.** La validación final es
// `parseWhatsappTemplateDraft` (`template-admin.ts`), la misma que usa la API
// pública, y una segunda comprobación acá sólo serviría para que un día las dos
// digan cosas distintas sobre el mismo formulario. Lo que sí hace la pantalla
// es pedir un `<input required>` por variable, que es la forma barata de que un
// ejemplo vacío no llegue nunca al servidor; si igual llega —JavaScript
// deshabilitado, un cliente de la API—, lo rechaza el parser con
// `missing_variable_examples`.

// Los dos topes que la referencia de componentes de Meta le pone al editor v1.
// Viven acá porque los usan el `maxLength` de los campos y el contador de
// caracteres, y un número suelto en el JSX se desincroniza del validador el día
// que Meta lo cambie.
export const WHATSAPP_TEMPLATE_BODY_MAX_LENGTH = 1024
export const WHATSAPP_TEMPLATE_FOOTER_MAX_LENGTH = 60

/** Los campos del formulario, tal cual salen del `FormData`. */
export type WhatsappTemplateFormFields = {
  body: string
  // Vacío es «sin pie», que es el caso normal: el `FOOTER` es opcional.
  footer: string
  // Posicional: el primero es el de `{{1}}`, y no el de la primera variable que
  // aparece en el texto. Ver `listWhatsappTemplateVariables`.
  examples: string[]
}

/**
 * Las variables posicionales del cuerpo, **ordenadas por su número** y sin
 * repetir.
 *
 * El orden es la parte que importa y no es cosmética: el `example.body_text` de
 * Meta es un array **posicional** —el índice 0 es el valor de `{{1}}`, el 1 el
 * de `{{2}}`— mientras que un cuerpo puede perfectamente escribir `{{2}}` antes
 * que `{{1}}` («Tu pedido {{2}} está listo, {{1}}»). Ordenar por aparición
 * dejaría el formulario pidiendo los ejemplos cruzados y la plantilla se
 * revisaría con el nombre del cliente en el lugar del número de pedido: Meta la
 * aprobaría igual —la forma es válida— y el error sólo se vería en el mensaje
 * que le llega al contacto.
 *
 * Se devuelven los números como string porque son etiquetas para la pantalla
 * (`{{1}}`), no aritmética.
 *
 * No se exige que la numeración sea correlativa. Meta sí lo exige, pero
 * rechazar acá un `{{1}}` + `{{3}}` sería adelantarle al usuario una regla que
 * ya le va a explicar quien la impone, y con el riesgo de equivocarnos: la
 * regla de las variables nombradas es otra y este editor no las modela.
 */
export function listWhatsappTemplateVariables(body: string): string[] {
  const found = new Set<number>()
  for (const match of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    found.add(Number(match[1]))
  }

  return [...found].sort((left, right) => left - right).map(String)
}

/**
 * Los `components` de Meta a partir de los campos del formulario.
 *
 * Es lo que separa «lo que el usuario escribió» de «lo que la API acepta», y
 * está de este lado del borde para que el `.tsx` no tenga que conocer ni la
 * forma del sobre ni la anidación del ejemplo.
 *
 * Dos decisiones que se ven en el resultado:
 *
 *   - **Los ejemplos se recortan a las variables que el cuerpo tiene hoy.** El
 *     formulario es vivo: alguien escribe dos variables, completa sus dos
 *     ejemplos y después borra una del texto. Mandar el ejemplo huérfano sería
 *     un rechazo de forma de Meta por un campo que el usuario ya no ve.
 *   - **Un ejemplo vacío se descarta en vez de viajar como cadena vacía.** Es lo
 *     que convierte «me falta uno» en un rechazo nuestro con nombre —el parser
 *     compara cuántos ejemplos hay contra cuántas variables tiene el cuerpo— en
 *     lugar de un `body_text: ["", "Ana"]` que Meta acepta como forma y rechaza
 *     al revisar, sin decir cuál estaba vacío. El precio es que el array puede
 *     quedar desalineado si el hueco no es el último, y no llega a importar:
 *     con un ejemplo de menos el parser no deja pasar la plantilla.
 *   - **Y no se rellena ninguno.** Inventar un valor para completar el array
 *     haría que Meta revise la plantilla con un ejemplo que nadie escribió, que
 *     es peor que no poder guardarla.
 */
export function buildWhatsappTemplateComponents(
  fields: WhatsappTemplateFormFields
): WhatsappTemplateComponent[] {
  const body = fields.body.trim()
  const variables = listWhatsappTemplateVariables(body)
  const examples = fields.examples
    .slice(0, variables.length)
    .map((example) => example.trim())
    .filter((example) => example.length > 0)

  const components: WhatsappTemplateComponent[] = [
    {
      type: "BODY",
      text: body,
      // El `example` sólo va cuando hay algo que ejemplificar: una plantilla sin
      // variables con un `body_text` vacío es un error de forma, no un campo de
      // más.
      ...(examples.length > 0 ? { example: { body_text: [examples] } } : {}),
    },
  ]

  const footer = fields.footer.trim()
  if (footer.length > 0) {
    components.push({ type: "FOOTER", text: footer })
  }

  return components
}
