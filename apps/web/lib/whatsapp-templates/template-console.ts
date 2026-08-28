import type { ConnectedPageRecord } from "@/lib/pages/page-registry"
import type {
  TemplateAdminFailure,
  TemplateAdminView,
} from "@/lib/whatsapp-templates/template-admin"
import type { WhatsappTemplateStatus } from "@/lib/whatsapp-templates/template-registry"

// Lo que **decide** la pantalla de plantillas, fuera del `.tsx`.
//
// Son cuatro preguntas y ninguna es de dibujo: qué números puede mostrar esta
// pantalla, cuál de ellos se está mirando, qué se puede hacer con cada fila del
// catálogo, y qué se le dice al usuario cuando la operación falla. Viven acá
// porque Vitest corre en entorno `node` con `include: **/*.{test,spec}.ts` y los
// componentes no se testean: una regla dentro del JSX es una regla sin red.
//
// Todo lo que sale de acá son **claves y banderas, nunca texto**: el copy vive
// en `content/i18n/app/{es,en}.ts` y la pantalla traduce lo que este módulo
// nombra. Es lo que permite que la misma decisión —«esta fila es ajena, es de
// sólo lectura»— se diga en dos idiomas sin duplicarse.

// ---------------------------------------------------------------------------
// El número que se está mirando
// ---------------------------------------------------------------------------

/**
 * Un número de WhatsApp como lo lista el selector de la pantalla.
 *
 * `pageId` es el `phone_number_id`, que es con lo que se direcciona todo el
 * dominio de plantillas (`listWhatsappTemplatesForTenant`), y no el uuid de la
 * conexión: usar el uuid obligaría a traducirlo en cada acción y dejaría dos
 * identificadores para lo mismo en la URL y en los formularios.
 */
export type WhatsappNumberOption = {
  pageId: string
  label: string
}

// Lo mínimo que hace falta de una conexión para ofrecerla en el selector. Un
// `Pick` y no el registro entero para dejar escrito que la decisión no mira el
// token, ni el modo de onboarding, ni el estado del import de historial.
export type WhatsappNumberSource = Pick<
  ConnectedPageRecord,
  "channel" | "status" | "metaPageId" | "name" | "whatsappPhoneE164"
>

/**
 * Los números de WhatsApp que esta pantalla puede mostrar, en el orden en que
 * vinieron.
 *
 * **Sólo los activos**, y es la regla que justifica el módulo: una conexión
 * desconectada no tiene token con el que hablarle a Graph, así que ofrecerla en
 * el selector produciría una pantalla que sólo sabe fallar. La página lista las
 * conexiones de los tres canales —`listTenantPages` no filtra— y Messenger e
 * Instagram no tienen catálogo de plantillas que mostrar.
 *
 * La etiqueta es el número en E.164 cuando está, y el nombre de la conexión
 * cuando no: el teléfono es lo que el usuario reconoce, pero es una columna que
 * puede faltar en una conexión vieja y una píldora sin texto no se puede elegir.
 */
export function toWhatsappNumberOptions(
  pages: readonly WhatsappNumberSource[]
): WhatsappNumberOption[] {
  return pages
    .filter((page) => page.channel === "whatsapp" && page.status === "active")
    .map((page) => ({
      pageId: page.metaPageId,
      label: page.whatsappPhoneE164 ?? page.name,
    }))
}

/**
 * Cuál de los números se muestra, a partir del `?number=` de la URL.
 *
 * El parámetro es entrada del usuario y no un contrato: un número que no es
 * suyo, uno que desconectó, o el `string[]` que produce `?number=a&number=b`
 * caen todos en el primero de la lista en vez de en un error. La pantalla
 * siempre tiene algo que mostrar mientras el tenant tenga un número activo, que
 * es la única condición real.
 *
 * `null` es «este tenant no tiene ningún número de WhatsApp», y la pantalla lo
 * trata como estado vacío con camino a `/connections`.
 */
export function resolveWhatsappNumberSelection(
  numbers: readonly WhatsappNumberOption[],
  param: string | string[] | undefined
): WhatsappNumberOption | null {
  const requested = Array.isArray(param) ? param[0] : param
  const match = numbers.find((number) => number.pageId === requested)

  return match ?? numbers[0] ?? null
}

/**
 * El único constructor de enlaces de la pantalla.
 *
 * El número seleccionado vive en la URL y no en estado de React, igual que el
 * modo del Inbox (ADR 0005): la pantalla tiene que ser recargable y compartible,
 * y así sigue siendo server component entera.
 */
export function whatsappTemplatesHref(pageId?: string | null): string {
  return pageId
    ? `/templates?number=${encodeURIComponent(pageId)}`
    : "/templates"
}

// ---------------------------------------------------------------------------
// Qué se puede hacer con una fila
// ---------------------------------------------------------------------------

/**
 * Por qué una plantilla es de sólo lectura, cuando lo es.
 *
 *   - `foreign`: no se creó desde este tenant. Es el caso frecuente y el que la
 *     ADR 0014 protege: el catálogo es de la WABA y puede haber números de otro
 *     cliente en ella, así que nadie edita ni borra lo que no creó.
 *   - `missing_meta_id`: es propia, pero el espejo no tiene su hsm id. Sin él no
 *     hay nodo de Graph al que pegarle para editar, y borrar exigiría hacerlo
 *     por nombre, que se lleva **todas** las versiones de idioma y quema el
 *     nombre 30 días. `template-admin.ts` lo rechaza por eso, y la pantalla lo
 *     dice antes en vez de dejar que el usuario descubra el 409.
 */
export type WhatsappTemplateLock = "foreign" | "missing_meta_id"

/**
 * El tono con el que se pinta el estado. Es presentación, sí, pero derivarlo en
 * el JSX significaría un `if` por estado repetido en cada sitio que muestre una
 * plantilla, y `unknown` es justamente el que se pinta mal cuando se decide a
 * ojo: **no es un error**, es un estado que no reconocemos, y en rojo se lee
 * como una plantilla rota.
 */
export type WhatsappTemplateTone =
  | "positive"
  | "pending"
  | "negative"
  | "neutral"

const STATUS_TONES: Record<WhatsappTemplateStatus, WhatsappTemplateTone> = {
  APPROVED: "positive",
  PENDING: "pending",
  IN_REVIEW: "pending",
  IN_APPEAL: "pending",
  REJECTED: "negative",
  PAUSED: "negative",
  DISABLED: "negative",
  PENDING_DELETION: "negative",
  LIMIT_EXCEEDED: "negative",
  // Neutral a propósito: Meta agrega estados sin cambiar de versión de API, y
  // lo que no sabemos leer no es una plantilla rota. Lo que sí hace la fila es
  // mostrar el valor crudo, que es el único dato con el que el cliente puede
  // buscarla en WhatsApp Manager.
  unknown: "neutral",
}

/** Una fila del catálogo, ya decidida. */
export type WhatsappTemplateRowView = {
  id: string
  name: string
  language: string
  status: WhatsappTemplateStatus
  // Sólo con `unknown`: es el estado literal que mandó Meta, y ahí es lo único
  // útil que se puede poner en pantalla.
  rawStatus: string | null
  category: TemplateAdminView["category"]
  tone: WhatsappTemplateTone
  own: boolean
  editable: boolean
  lock: WhatsappTemplateLock | null
  // Si editarla la saca de circulación. Es lo que dispara el aviso **antes** de
  // guardar: una plantilla aprobada deja de poder enviarse hasta que Meta la
  // re-apruebe, y esa es la consecuencia que el usuario no ve venir.
  returnsToReviewOnEdit: boolean
  // Si la fila tiene que ofrecer la explicación del rechazo.
  rejected: boolean
}

/**
 * Qué se puede hacer con esta plantilla, y qué hay que avisar antes.
 *
 * La regla de propiedad es **la misma** que aplica `template-admin.ts` en el
 * servidor, y esto no la reemplaza: la pantalla que oculta un botón no autoriza
 * nada. Existe para que el usuario no descubra un 403 después de escribir un
 * cuerpo entero, que es la diferencia entre una regla y una emboscada.
 */
export function toWhatsappTemplateRowView(
  template: TemplateAdminView
): WhatsappTemplateRowView {
  const lock = resolveLock(template)

  return {
    id: template.id,
    name: template.name,
    language: template.language,
    status: template.status,
    rawStatus: template.rawStatus ?? null,
    category: template.category,
    tone: STATUS_TONES[template.status],
    own: template.own,
    editable: lock === null,
    lock,
    returnsToReviewOnEdit: template.status === "APPROVED",
    rejected: template.status === "REJECTED",
  }
}

export function toWhatsappTemplateRowViews(
  templates: readonly TemplateAdminView[]
): WhatsappTemplateRowView[] {
  return templates.map(toWhatsappTemplateRowView)
}

// El orden importa: una plantilla ajena a la que además le falta el hsm id se
// explica por ajena, que es la razón que el usuario puede entender y la que no
// cambia si mañana llega el sync. Decir «nos falta un id» de algo que igual no
// podría tocar sería confesar un detalle nuestro en lugar de contestar su
// pregunta.
function resolveLock(template: TemplateAdminView): WhatsappTemplateLock | null {
  if (!template.own) return "foreign"
  if (!template.metaTemplateId?.trim()) return "missing_meta_id"
  return null
}

// ---------------------------------------------------------------------------
// Qué se le dice al usuario cuando falla
// ---------------------------------------------------------------------------

/**
 * Los rechazos que la pantalla sabe redactar en el idioma del usuario.
 *
 * `TemplateAdminFailure.message` es texto en inglés pensado para la API pública
 * —un integrador leyendo un JSON—, así que la consola no lo muestra tal cual:
 * traduce por el **código**, que es el campo estable. `unexpected` es el
 * comodín, y no es un descuido: el catálogo de códigos de `template-admin.ts`
 * puede crecer sin que esta pantalla se entere, y un código sin traducción tiene
 * que producir un mensaje honesto y no una clave rota en pantalla.
 */
export const WHATSAPP_TEMPLATE_ERROR_KEYS = [
  "invalid_request",
  "invalid_template_name",
  "invalid_template_language",
  "invalid_template_category",
  "invalid_template_components",
  "missing_variable_examples",
  "page_not_connected",
  "waba_not_resolved",
  "template_not_found",
  "template_not_owned",
  "template_missing_meta_id",
  "template_create_failed",
  "template_update_failed",
  "template_delete_failed",
  "unexpected",
] as const

export type WhatsappTemplateErrorKey =
  (typeof WHATSAPP_TEMPLATE_ERROR_KEYS)[number]

// Los tres códigos que envuelven un rechazo de Graph. Se listan aparte porque
// son los únicos donde el texto crudo aporta: lo escribió
// `explainWhatsappTemplateAdminError` para que el cliente sepa qué arreglar, y
// nuestra traducción sólo puede decir «Meta lo rechazó».
const GRAPH_FAILURES: readonly string[] = [
  "template_create_failed",
  "template_update_failed",
  "template_delete_failed",
]

export type WhatsappTemplateFailureView = {
  key: WhatsappTemplateErrorKey
  // El texto de Meta, cuando lo nuestro no alcanza. `null` el resto de las
  // veces: repetir en inglés lo que la línea de arriba ya dijo traducido es
  // ruido, y encima ruido que parece un error del producto.
  detail: string | null
}

/**
 * Traduce un rechazo del dominio a lo que la pantalla tiene que mostrar.
 *
 * Sólo el código y el mensaje: el `status` HTTP y el `reason` del log son
 * vocabulario de la API pública y del observability, y no tienen nada que hacer
 * en una pantalla.
 */
export function describeWhatsappTemplateFailure(
  failure: Pick<TemplateAdminFailure, "error" | "message">
): WhatsappTemplateFailureView {
  const key = WHATSAPP_TEMPLATE_ERROR_KEYS.find(
    (candidate) => candidate === failure.error
  )

  if (!key) {
    // Sin traducción propia, el crudo es lo único honesto que se puede mostrar:
    // un código que no conocemos con un texto que sí explica algo.
    return { key: "unexpected", detail: failure.message }
  }

  return {
    key,
    detail: GRAPH_FAILURES.includes(key) ? failure.message : null,
  }
}
