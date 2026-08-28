import { GRAPH_FACEBOOK_BASE } from "@/lib/meta/graph-version"
import {
  explainWhatsappError,
  graphRequest,
  WhatsappApiError,
} from "@/lib/meta/whatsapp-client"
import type { LogAction } from "@/lib/observability/logger"
import { log } from "@/lib/observability/logger"
import {
  extractMetaErrorCode,
  extractMetaErrorMessage,
  extractMetaErrorSubcode,
} from "@/lib/outbound/meta-send"
import {
  normalizeWhatsappTemplateCategory,
  type WhatsappTemplateCategory,
} from "@/lib/whatsapp-templates/template-registry"

// **Administración del catálogo de plantillas en Graph** (ADR 0014): las cuatro
// llamadas que crean, listan, editan y borran una [Plantilla] en la WABA del
// cliente. Es la capa de red y nada más: el espejo local vive en
// `lib/whatsapp-templates/template-registry.ts` y la decisión de si una
// plantilla se puede enviar vive en `template-gate.ts`.
//
// **Por qué un archivo aparte de `whatsapp-client.ts`.** Aquel pasa las 1.800
// líneas y ya cuenta una historia completa —el onboarding por Embedded Signup,
// la media y el envío—; el CRUD del catálogo es otra, ocurre cuando se le
// antoja al cliente y no dentro de ningún flujo, y meterla ahí habría dejado un
// archivo que nadie vuelve a leer entero. Lo que **no** se duplicó es el
// transporte: `graphRequest` se exportó justamente para esto, así que el plazo,
// el `json()` defensivo y el log del fallo de red están resueltos una sola vez.
// Un segundo helper de request habría dejado dos formas de fallar contra el
// mismo Graph, que se desincronizan en la primera corrección aplicada a una.
//
// **Devuelve un discriminado; no lanza.** `whatsapp-client.ts` lanza
// `WhatsappApiError` porque sus llamadas son pasos de un flujo que se aborta
// entero y cuyo `reason` decide la pantalla de conexión. Acá el consumidor es
// una ruta HTTP que tiene que contestar: necesita un status, un texto para el
// cliente y el mensaje crudo de Meta, todo junto y sin volver a mirar el JSON.
// Una excepción la obligaría a un `try` por llamada para reconstruir lo mismo,
// y el `WhatsappFailureReason` que lleva `WhatsappApiError` no tiene ningún
// miembro que signifique «Meta rechazó la creación de una plantilla». La única
// excepción que sí puede salir de acá es la que este módulo no origina: un
// `WhatsappApiError` de red se atrapa y se convierte en un fallo con `502`.
//
// **La forma de las llamadas está verificada contra la doc de Meta**, una por
// una, y las que no se pudieron confirmar están anotadas como tales en vez de
// completadas por analogía. La regla del repo —no adivinar la superficie de
// Meta— importa doble acá: tres de estas cuatro llamadas dejan efectos
// **permanentes** en la WABA del cliente.

const GRAPH = GRAPH_FACEBOOK_BASE

// Lo mínimo que el espejo necesita, y nada más (ADR 0014: no se espejan los
// `components`). Se pide explícito porque la proyección por defecto de Graph no
// es un contrato: pedir los cinco campos es lo que hace que un cambio de
// default de Meta no vacíe el sync en silencio.
const TEMPLATE_FIELDS = "id,name,language,status,category"

// El tamaño de página que pedimos. Graph lo recorta por su cuenta si es más de
// lo que ese edge permite —el `limit` es una preferencia, no una garantía—, así
// que el número alto no es una apuesta: 6.000 plantillas en páginas de 25 son
// 240 requests, y el paginador tiene que sobrevivir a esa WABA.
const DEFAULT_PAGE_SIZE = 100

// Tope defensivo de páginas. No modela ningún límite de Meta (el de 6.000 por
// WABA no se modela, se traduce el error): existe porque un cursor que Graph
// devuelve mal —o que apunta a sí mismo— convertiría el job de sync en un bucle
// infinito dentro de un Worker, y un job colgado es peor que un catálogo
// incompleto.
//
// **El número se calcula sobre el peor caso, no sobre el que pedimos.** El
// `limit` de arriba es una preferencia: si este edge lo recorta a 25 —el
// recorte más chico que documenta Meta—, una WABA llena son 240 páginas, y un
// tope de 100 habría cortado el sync en el 41 % del catálogo diciendo
// `truncated` para siempre, sin que nadie pudiera subirlo desde afuera (el
// sync corre con los defaults). 400 cubre ese peor caso con margen y sigue
// siendo finito, que es lo único que este tope tiene que garantizar.
//
// No es mucho más alto a propósito: cada página es una subrequest de Workers y
// el presupuesto de la invocación (1.000) se comparte con las escrituras del
// espejo y con los demás jobs del batch de la cola.
const DEFAULT_MAX_PAGES = 400

// ---------------------------------------------------------------------------
// Los componentes, tal como Graph los espera
// ---------------------------------------------------------------------------

// **Acá sí se modela la forma, y en el envío no.** No es una incoherencia: son
// dos superficies distintas. Al enviar, los `components` son los valores con
// los que se hidrata la plantilla y viajan `unknown[]` a propósito, porque
// validarlos sería prometer una comprobación que decidimos no hacer
// (`WhatsappOutboundTemplate`). Al **crear**, los `components` son la plantilla
// misma: los escribe nuestro propio editor, un campo mal nombrado se paga con
// un rechazo automático de Meta, y el tipo es la única documentación que el
// que arma el body va a leer.
//
// Las claves van en snake_case porque son de Meta y viajan literales a
// `JSON.stringify`. Es la excepción explícita a la convención del repo: el
// nombre `body_text` no es nuestro y renombrarlo requeriría un traductor cuyo
// único aporte sería una oportunidad más de equivocarse.

/**
 * El cuerpo de la plantilla. Es el único componente obligatorio.
 *
 * `example` es lo que **más se olvida y no se puede omitir**: Meta exige un
 * valor de ejemplo por cada variable y rechaza automáticamente la plantilla si
 * faltan. La forma es un array **de arrays** —`[["Ana", "3 de mayo"]]`—, no un
 * array plano: el externo es el conjunto de ejemplos y el interno los valores
 * de ese conjunto, en el mismo orden en que aparecen los `{{1}}`, `{{2}}` en el
 * texto. Una plantilla con variables y `body_text: ["Ana"]` (sin anidar) es el
 * error de forma más común del endpoint.
 *
 * Este módulo **no valida** que haya un ejemplo por variable, por la misma
 * razón que el envío no cuenta parámetros: el formulario los pide y un falso
 * rechazo nuestro es peor que uno de Meta, porque contra el nuestro el cliente
 * no puede hacer nada. El tipo documenta; Meta decide.
 */
export type WhatsappTemplateBodyComponent = {
  type: "BODY"
  // Máximo 1024 caracteres según la referencia de componentes de Meta. No se
  // valida acá: el editor lo hace donde puede avisar antes de guardar.
  text: string
  example?: { body_text: string[][] }
}

/**
 * El pie. Texto fijo, sin variables y sin `example` (máximo 60 caracteres).
 */
export type WhatsappTemplateFooterComponent = {
  type: "FOOTER"
  text: string
}

// La unión es cerrada a `BODY` y `FOOTER` porque eso es el editor v1 (ADR
// 0014): el header con media exige la Resumable Upload API —Resender
// hospedando media saliente, que la ADR 0013 cerró— y los botones quedaron
// fuera. Cerrarla es lo que hace que agregar un componente sea una decisión y
// no un descuido.
export type WhatsappTemplateComponent =
  | WhatsappTemplateBodyComponent
  | WhatsappTemplateFooterComponent

// ---------------------------------------------------------------------------
// Los resultados
// ---------------------------------------------------------------------------

/**
 * El fallo, con todo lo que la ruta necesita para contestar.
 *
 * `status` es el de Graph tal cual —o `502` cuando no se llegó a hablar con
 * Meta, y `400` en el único rechazo que este módulo hace por su cuenta—, así
 * que la ruta puede decidir entre reintentable y definitivo sin interpretar el
 * texto. `error` es el mensaje crudo de Meta y `reason` la traducción
 * accionable, que es `null` cuando el código no está en ningún catálogo: ahí el
 * crudo es lo único honesto que se le puede mostrar al cliente.
 */
export type WhatsappTemplateApiFailure = {
  ok: false
  status: number
  metaErrorCode: number | null
  error: string
  reason: string | null
}

/**
 * Una plantilla como la cuenta Graph, con los cinco campos que el espejo guarda.
 *
 * `status` va **crudo**, sin normalizar: la columna de la 0018 no tiene check y
 * el espejo normaliza al leer, no al escribir. Normalizar acá convertiría un
 * estado que Meta agregó ayer en `unknown` para siempre, y el dato real se
 * perdería antes de tocar la base.
 *
 * `category`, en cambio, sí se normaliza, y por el motivo opuesto: esa columna
 * **sí** tiene check. Meta la manda en mayúsculas (`UTILITY`) y la 0018 la
 * guarda en minúsculas, así que una categoría que no reconocemos tiene que
 * llegar como `null` —el espejo la acepta— y no como un string que haría
 * fallar el insert de la plantilla entera.
 */
export type WhatsappGraphTemplate = {
  // El hsm id. Es lo único con lo que se borra una sola versión de idioma.
  id: string
  name: string
  language: string
  status: string
  category: WhatsappTemplateCategory | null
}

export type WhatsappTemplateListResult =
  | {
      ok: true
      templates: WhatsappGraphTemplate[]
      // `true` significa «esto no es el catálogo entero»: se agotó el tope de
      // páginas, el cursor dejó de avanzar o Graph falló a mitad de la
      // paginación. Es un dato del llamador y no un error de este módulo —lo
      // que se trajo es válido—, pero un sync que lo ignore deja el espejo
      // incompleto sin que nadie se entere, así que viaja en el resultado en
      // vez de en un log que nadie mira.
      truncated: boolean
      // Cuántas filas trajo Graph que **no** se pudieron leer (sin `id`,
      // `name`, `language` o `status`) y se descartaron. Sin este número,
      // `templates.length` no se puede comparar contra lo que Meta dice tener y
      // un descarte masivo —un cambio de forma de la respuesta, por ejemplo— se
      // vería idéntico a una WABA con menos plantillas.
      dropped: number
    }
  | WhatsappTemplateApiFailure

export type WhatsappTemplateCreateResult =
  | {
      ok: true
      // Los tres campos que devuelve el POST. `status` viene crudo por el mismo
      // motivo que en el listado; es siempre uno de revisión, porque Meta
      // revisa toda plantilla nueva.
      id: string
      status: string
      category: WhatsappTemplateCategory | null
    }
  | WhatsappTemplateApiFailure

// La edición y el borrado devuelven `{ success: true }` y nada más: no hay nada
// que leer, así que comparten resultado.
export type WhatsappTemplateMutationResult =
  | { ok: true }
  | WhatsappTemplateApiFailure

// ---------------------------------------------------------------------------
// GET /{waba_id}/message_templates — el catálogo, paginado
// ---------------------------------------------------------------------------

/**
 * Trae el catálogo entero de plantillas de una WABA, siguiendo los cursores.
 *
 * **Pagina porque el caso grande es real**: el tope es de 6.000 plantillas por
 * WABA y el día que se conecte un número de Coexistence de un negocio que lleva
 * años usando WhatsApp Manager, la primera página va a ser una fracción del
 * catálogo. Un sync que se quede con la primera página no falla: deja el espejo
 * mintiendo, que es peor, porque el gate del envío falla abierto y nadie lo
 * nota.
 *
 * **Cómo se avanza, y por qué así.** Graph devuelve `paging.next` (una URL
 * completa) y `paging.cursors.after` (el cursor suelto). Se leen los dos y cada
 * uno contesta una pregunta distinta: `next` dice **si hay** otra página
 * —`cursors.after` también viene en la última, así que usarlo solo sería pedir
 * páginas vacías para siempre— y `after` es **con qué** se pide. Se rearma la
 * URL en vez de seguir `next` verbatim para que `fields` y `limit` no dependan
 * de lo que Meta haya decidido copiar en ese enlace.
 *
 * **Tres frenos, y ninguno es un límite de Meta.** Se corta al llegar al tope
 * de páginas, se corta si el cursor se repite, y se corta si `paging.next`
 * anuncia otra página pero el cursor con el que pedirla no se puede leer. El
 * segundo es el que importa: un cursor que no avanza es un bucle infinito
 * dentro de un Worker, y un job de sync colgado se lleva puesta la cola entera.
 * Los tres casos devuelven lo que se alcanzó a leer con `truncated: true`,
 * porque media lista es información y un error no lo sería.
 *
 * **Y un fallo de Graph a mitad del recorrido tampoco tira lo ya leído.** Con
 * 240 páginas, la forma más probable de que termine una paginación larga no es
 * el tope sino un throttle en la página 50, y devolver el fallo ahí descartaría
 * 4.900 plantillas que ya están en memoria para espejar cero. Se devuelve lo
 * leído con `truncated: true` —la línea del fallo ya quedó escrita igual— y
 * sólo se devuelve el fallo cuando no hay **nada** que salvar, que es el caso
 * en el que el llamador sí necesita el status y el código de Meta: el sync los
 * usa para marcar el token inválido.
 */
export async function listWhatsappTemplatesInGraph(input: {
  accessToken: string
  wabaId: string
  pageSize?: number
  maxPages?: number
}): Promise<WhatsappTemplateListResult> {
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES

  const templates: WhatsappGraphTemplate[] = []
  let dropped = 0
  // Los cursores ya usados. Un `Set` y no «el anterior» porque un ciclo de dos
  // páginas que se apuntan entre sí tampoco avanza y pasaría la comparación
  // contra el inmediato anterior.
  const seenCursors = new Set<string>()
  let after: string | null = null

  // Lo leído hasta acá, marcado como incompleto. Es la respuesta a cualquier
  // corte que ocurra con páginas ya en memoria.
  const partial = () =>
    ({ ok: true, templates, dropped, truncated: true }) as const

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(
      `${GRAPH}/${encodeURIComponent(input.wabaId)}/message_templates`
    )
    url.searchParams.set("fields", TEMPLATE_FIELDS)
    url.searchParams.set("limit", String(pageSize))
    if (after) url.searchParams.set("after", after)

    let response
    try {
      response = await graphRequest(
        {
          step: "templates",
          action: "template_list",
          accountId: input.wabaId,
        },
        url,
        { headers: bearer(input.accessToken) }
      )
    } catch (error) {
      // `networkFailure` relanza lo que no sea un fallo de red, así que se
      // llama siempre: un bug nuestro tiene que seguir subiendo aunque haya
      // páginas leídas.
      const failure = networkFailure(error)
      return templates.length > 0 ? partial() : failure
    }

    if (!response.ok) {
      // El fallo se construye igual —es lo que deja la línea de log con el
      // status y el código de Meta— y recién después se decide qué devolver.
      const failure = graphFailure({
        action: "template_list",
        wabaId: input.wabaId,
        status: response.status,
        data: response.data,
      })
      return templates.length > 0 ? partial() : failure
    }

    const read = readTemplates(response.data)
    templates.push(...read.templates)
    dropped += read.dropped

    const next = readNextCursor(response.data)
    // `end` es la única salida completa: Graph dijo que no hay más páginas.
    if (next.kind === "end") {
      return { ok: true, templates, dropped, truncated: false }
    }
    // `unreadable` es «hay más páginas y no sé pedirlas»: no es el final del
    // catálogo aunque se le parezca desde acá.
    if (next.kind === "unreadable") return partial()
    if (seenCursors.has(next.after)) return partial()
    seenCursors.add(next.after)
    after = next.after
  }

  return partial()
}

// ---------------------------------------------------------------------------
// POST /{waba_id}/message_templates — la creación
// ---------------------------------------------------------------------------

/**
 * Crea la plantilla en la WABA del cliente y devuelve su hsm id.
 *
 * **Deja un efecto permanente**: Meta la revisa automáticamente, cuenta contra
 * el tope de 6.000 de la WABA y su nombre queda tomado. No es reintentable a la
 * ligera.
 *
 * El body es el que documenta la referencia del edge, con los cuatro campos
 * obligatorios (`name`, `language`, `category`, `components`).
 * `allow_category_change` **no se manda**: dejaría que Meta reclasifique una
 * `utility` como `marketing` —que se factura distinto— sin que el cliente lo
 * haya pedido, y el espejo guardaría la categoría que eligió el formulario y no
 * la que quedó.
 */
export async function createWhatsappTemplateInGraph(input: {
  accessToken: string
  wabaId: string
  name: string
  language: string
  category: WhatsappTemplateCategory
  components: WhatsappTemplateComponent[]
}): Promise<WhatsappTemplateCreateResult> {
  const url = new URL(
    `${GRAPH}/${encodeURIComponent(input.wabaId)}/message_templates`
  )

  let response
  try {
    response = await graphRequest(
      { step: "templates", action: "template_create", accountId: input.wabaId },
      url,
      {
        method: "POST",
        headers: {
          ...bearer(input.accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: input.name,
          // Va tal cual: la identidad de la plantilla es `(nombre, idioma)` y
          // `es` y `es_AR` son dos plantillas distintas. Normalizar acá sería
          // crear una que el cliente no pidió.
          language: input.language,
          category: toGraphCategory(input.category),
          components: input.components,
        }),
      }
    )
  } catch (error) {
    return networkFailure(error)
  }

  if (!response.ok) {
    return graphFailure({
      action: "template_create",
      wabaId: input.wabaId,
      name: input.name,
      language: input.language,
      status: response.status,
      data: response.data,
    })
  }

  const id = readString(response.data.id)
  if (!id) {
    // Un 200 sin id es la peor respuesta posible: la plantilla puede haberse
    // creado y no tenemos con qué borrarla ni con qué espejarla. Se reporta
    // como fallo —es lo único que la ruta puede hacer— pero con un texto que
    // no diga «no se creó», porque no lo sabemos.
    return graphFailure({
      action: "template_create",
      wabaId: input.wabaId,
      name: input.name,
      language: input.language,
      status: response.status,
      data: response.data,
      fallbackError: "Meta accepted the template but returned no template id",
      fallbackReason:
        "Meta answered the creation without a template id, so Resender can't mirror it. Check WhatsApp Manager before retrying: the template may already exist there, and creating it again would fail on the duplicate name.",
    })
  }

  return {
    ok: true,
    id,
    status: readString(response.data.status) ?? "",
    category: readCategory(response.data.category),
  }
}

// ---------------------------------------------------------------------------
// POST /{template_id} — la edición
// ---------------------------------------------------------------------------

/**
 * Edita una plantilla existente.
 *
 * **Va contra el id de la plantilla, no contra la WABA**, y es el único de los
 * cuatro que no cuelga de `/{waba_id}/message_templates`: el edge de la WABA no
 * tiene `POST` de edición. Pasar el `waba_id` acá crearía... nada, daría un
 * error de Graph difícil de leer; la firma pide `metaTemplateId` por su nombre
 * para que el sitio de la llamada no se pueda confundir.
 *
 * **Editar devuelve la plantilla a revisión.** Meta revisa automáticamente al
 * crear *y al editar*, así que una plantilla `APPROVED` deja de poder enviarse
 * en cuanto esto responde `success` y hasta que se re-apruebe. No es un efecto
 * de borde: es la razón de que la pantalla tenga que avisar **antes** de
 * guardar (ADR 0014) y de que el espejo tenga que esperar el webhook de estado
 * en lugar de asumir que sigue aprobada.
 *
 * `name` y `language` no se mandan: son la identidad de la plantilla. La
 * referencia del edge los lista entre los campos editables y la guía de gestión
 * de plantillas no; ante dos páginas de Meta que no coinciden, este módulo no
 * ofrece lo que no puede confirmar, y renombrar tampoco está en el editor v1.
 */
export async function updateWhatsappTemplateInGraph(input: {
  accessToken: string
  metaTemplateId: string
  components: WhatsappTemplateComponent[]
  category?: WhatsappTemplateCategory
}): Promise<WhatsappTemplateMutationResult> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(input.metaTemplateId)}`)

  let response
  try {
    response = await graphRequest(
      { step: "templates", action: "template_update" },
      url,
      {
        method: "POST",
        headers: {
          ...bearer(input.accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          components: input.components,
          ...(input.category
            ? { category: toGraphCategory(input.category) }
            : {}),
        }),
      }
    )
  } catch (error) {
    return networkFailure(error)
  }

  return readMutationResult({
    action: "template_update",
    status: response.status,
    ok: response.ok,
    data: response.data,
  })
}

// ---------------------------------------------------------------------------
// DELETE /{waba_id}/message_templates — el borrado
// ---------------------------------------------------------------------------

/**
 * Borra **una sola versión de idioma** de una plantilla.
 *
 * El endpoint acepta `name` o `hsm_id`, y la diferencia entre los dos no es de
 * estilo: **borrar por `name` se lleva todas las versiones de idioma de esa
 * plantilla** y, si estaba aprobada, deja el nombre inutilizable por 30 días.
 * Un cliente que quiso borrar el español y perdió también el inglés, el
 * portugués y el nombre durante un mes no tiene forma de deshacerlo.
 *
 * Por eso `hsmId` es un parámetro **obligatorio y sin default**: no hay
 * sobrecarga «por nombre», no hay `hsmId?` con fallback, y no hay forma de
 * llamar a esta función que borre más de un idioma. Como el tipo no alcanza
 * —`metaTemplateId ?? ""` compila igual— hay además un rechazo en tiempo de
 * ejecución: con un `hsmId` vacío **no se llama a Graph**, porque un
 * `?hsm_id=&name=pedido` es exactamente la petición que borra todo.
 *
 * `name` se manda **además** del `hsm_id` porque así lo hace el ejemplo de
 * «delete by ID» de la propia doc de Meta. No es un fallback: acompaña al id,
 * no lo sustituye, y sin id esta función no llama.
 */
export async function deleteWhatsappTemplateInGraph(input: {
  accessToken: string
  wabaId: string
  hsmId: string
  name: string
}): Promise<WhatsappTemplateMutationResult> {
  const hsmId = input.hsmId.trim()
  if (!hsmId) {
    // El único fallo que este módulo produce sin hablar con Graph. Es `400` y
    // no `502` porque no hay nada que reintentar: falta un dato, y el dato lo
    // tiene que traer el espejo o WhatsApp Manager.
    return {
      ok: false,
      status: 400,
      metaErrorCode: null,
      error: "hsm_id is required to delete a template",
      reason:
        "Resender doesn't know this template's Meta id, and deleting by name would delete every language version of it and block the name for 30 days. Delete this template from WhatsApp Manager instead.",
    }
  }

  const url = new URL(
    `${GRAPH}/${encodeURIComponent(input.wabaId)}/message_templates`
  )
  url.searchParams.set("hsm_id", hsmId)
  url.searchParams.set("name", input.name)

  let response
  try {
    response = await graphRequest(
      { step: "templates", action: "template_delete", accountId: input.wabaId },
      url,
      { method: "DELETE", headers: bearer(input.accessToken) }
    )
  } catch (error) {
    return networkFailure(error)
  }

  return readMutationResult({
    action: "template_delete",
    wabaId: input.wabaId,
    name: input.name,
    status: response.status,
    ok: response.ok,
    data: response.data,
  })
}

// ---------------------------------------------------------------------------
// Traducción de los errores de administración
// ---------------------------------------------------------------------------

/**
 * Traduce un error de **administración** a algo que el cliente pueda ejecutar.
 *
 * Es un catálogo aparte del de `explainWhatsappError` y no una ampliación suya,
 * porque son dos familias que no se tocan: aquel traduce los rechazos del
 * **envío** —la ventana cerrada, la plantilla pausada por calidad, el conteo de
 * parámetros— y este los del CRUD. Un mismo número puede querer decir cosas
 * distintas en cada superficie, y mezclarlos habría hecho que agregar un caso
 * del CRUD obligara a releer los del envío.
 *
 * Los que **sí** son comunes —el token vencido, el bloqueo por abuso, los rate
 * limits de Graph— no se reescriben acá: se delega en `explainWhatsappError`,
 * que ya los tiene. Dos traducciones del mismo código divergen en la primera
 * corrección que se aplique a una sola.
 *
 * Cada código está verificado contra la doc de Meta —la tabla de errores del
 * edge `message_templates` y la referencia de códigos de error de Cloud API— y
 * **ninguno se dedujo del vecino**: la familia `2388xxx` está llena de huecos.
 * Lo que no se pudo confirmar no está: en particular **el nombre duplicado y la
 * plantilla inexistente**, que Meta reporta pero cuyos códigos no aparecen en
 * ninguna tabla oficial. Para esos dos el módulo cae en `error_user_msg`, que
 * es el texto que la propia Meta escribió para mostrarle al usuario — mejor
 * fuente que un número copiado del blog de un BSP.
 *
 * Devuelve `null` cuando no hay traducción, con el mismo criterio que
 * `explainWhatsappError`: el mensaje crudo de Meta viaja igual, y traducir de
 * más es inventarle al cliente una causa que no sabemos.
 */
export function explainWhatsappTemplateAdminError(
  data: unknown
): string | null {
  const code = extractMetaErrorCode(data)
  if (code === null) return null

  // 2388019 — «Message Template Limit Exceeded»: el tope de plantillas de la
  // WABA. El límite **no se modela** (ADR 0014): no llevamos contador ni
  // chequeo previo, se traduce el error, y este es el error. No se puede subir,
  // así que el mensaje manda a borrar y no a esperar.
  if (code === 2388019) {
    return "This WhatsApp Business account has reached its message template limit. Delete templates you no longer send — remember a deleted approved name can't be reused for 30 days — before creating new ones."
  }

  // 80007 y 80008 — throttling de la WhatsApp Business Account. 80008 es el que
  // la referencia del edge `message_templates` lista para el GET, el POST y el
  // DELETE, y es el que aparece al pasarse del tope de creaciones por hora. Van
  // juntos porque la acción del cliente es idéntica: esperar. Tampoco se
  // modela: si contáramos las creaciones por hora tendríamos que acertarle al
  // número de Meta, y equivocarnos por abajo sería rechazar creaciones que Meta
  // habría aceptado.
  if (code === 80008 || code === 80007) {
    return "Too many template calls to this WhatsApp Business account in a short time. Meta throttles template creation per hour: wait a few minutes and try again — nothing was lost."
  }

  // 200002 — «HSM Template creation failed». Es el rechazo genérico de la
  // creación y no dice por qué; el mensaje lo admite en vez de inventar una
  // causa, y manda al único sitio donde Meta la explica.
  if (code === 200002) {
    return "Meta rejected the template. The exact reason isn't in the API response: open WhatsApp Manager, where the rejection is spelled out, and check the name (lowercase letters, numbers and underscores only), the language code and the example values."
  }

  // 139000 — «Blocked by Integrity». No es un problema del contenido de esta
  // plantilla sino de la cuenta: no se arregla reescribiendo el cuerpo.
  if (code === 139000) {
    return "Meta's integrity systems blocked this action on the WhatsApp Business account. It isn't about this template's wording: check the account status in Meta Business Manager and appeal there if it's restricted."
  }

  // 131009 — «Parameter value is not valid». Es el que se lleva los valores
  // fuera de catálogo, la categoría incluida. El mensaje nombra los sospechosos
  // sin afirmar cuál fue: Meta no lo dice.
  if (code === 131009) {
    return "One of the values in the request isn't valid. Check the category (only UTILITY, MARKETING and AUTHENTICATION exist), the language code and the component fields."
  }

  // 2388040 — «Character limit exceeded». La referencia de componentes fija
  // 1024 caracteres para el cuerpo y 60 para el pie, y el pie es el que se pasa
  // casi siempre.
  if (code === 2388040) {
    return "A field in the template is longer than Meta allows: the body maxes out at 1024 characters and the footer at 60. Shorten it and save again."
  }

  // 2388072 y 2388073 — formato del cuerpo y del pie. Son dos códigos y no uno
  // porque señalan campos distintos, y saber cuál de los dos revisar es la
  // mitad del arreglo.
  if (code === 2388072) {
    return "The template body has invalid formatting. Check the variables: they're written {{1}}, {{2}} numbered from one and in order, with no blank line or double space around them."
  }
  if (code === 2388073) {
    return "The template footer has invalid formatting. The footer is plain fixed text: it can't contain variables, links or line breaks."
  }

  // 2388293 — «Parameters words ratio exceeds limit»: demasiadas variables para
  // lo que mide el texto. La corrección es escribir más texto fijo, que no es
  // obvio desde el error.
  if (code === 2388293) {
    return "The template has too many variables for how short it is. Meta rejects bodies that are mostly placeholders: write more fixed text around them, or send fewer variables."
  }

  // 2388299 — «Leading or trailing parameters not allowed»: una variable no
  // puede abrir ni cerrar el cuerpo.
  if (code === 2388299) {
    return "A variable can't be the first or the last thing in the template body. Add fixed text before the first {{1}} and after the last one."
  }

  // 2388039 — «Message template status can't be changed». Sale al editar algo
  // que Meta no deja mover en ese estado; la salida es crear otra, no insistir.
  if (code === 2388039) {
    return "This template can't be edited in its current status. Wait until Meta finishes reviewing it, or create a new template instead — a template under review or disabled can only be deleted."
  }

  // 200 — «Permissions error». En este canal significa casi siempre lo mismo:
  // el cliente compartió la WABA con permisos de mensajería pero no de
  // administración, y eso se arregla reconectando.
  if (code === 200) {
    return "The connected token can't manage templates on this WhatsApp Business account. Reconnect the number in Resender and accept the WhatsApp management permission when Meta asks for it."
  }

  return null
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

// El token del cliente va en `Authorization` y nunca en el query, igual que en
// `whatsapp-client.ts`: una URL con el token en el querystring termina, tarde o
// temprano, dentro del mensaje de un error que alguien loguea.
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

// Construye el fallo y deja **una** línea de log. `meta_rejected` y no un motivo
// propio por llamada: los cuatro casos son el mismo hecho —Graph dijo que no— y
// lo que los distingue ya está en `action`, que es un valor por operación
// justamente para esto.
//
// Nunca se loguea el body: los `components` son datos del cliente final (ver
// `logger.ts`) y ni siquiera hay un campo por el cual pudieran entrar. El nombre
// y el idioma sí, que son identificadores de catálogo.
function graphFailure(input: {
  action: LogAction
  wabaId?: string
  name?: string
  language?: string
  status: number
  data: Record<string, unknown>
  fallbackError?: string
  fallbackReason?: string | null
}): WhatsappTemplateApiFailure {
  const metaErrorCode = extractMetaErrorCode(input.data)
  const metaErrorMessage = extractMetaErrorMessage(input.data)

  log({
    entrypoint: "route",
    action: input.action,
    outcome: "failed",
    reason: "meta_rejected",
    channel: "whatsapp",
    ...(input.wabaId ? { accountId: input.wabaId } : {}),
    ...(input.name ? { templateName: input.name } : {}),
    ...(input.language ? { templateLanguage: input.language } : {}),
    status: input.status,
    errorCode: metaErrorCode ?? undefined,
    errorSubcode: extractMetaErrorSubcode(input.data) ?? undefined,
    errorMessage: metaErrorMessage ?? undefined,
  })

  return {
    ok: false,
    status: input.status,
    metaErrorCode,
    error:
      metaErrorMessage ??
      input.fallbackError ??
      `Meta returned HTTP ${input.status}`,
    reason:
      explainWhatsappTemplateAdminError(input.data) ??
      explainWhatsappError(input.data)?.message ??
      // Lo último antes de rendirse: el texto que Meta escribió **para
      // mostrarle al usuario**. Vale más que el `error.message` técnico y es la
      // única fuente para los dos casos que no tienen código documentado —el
      // nombre duplicado y la plantilla inexistente—, que son justo dos de los
      // más frecuentes del CRUD.
      readUserMessage(input.data) ??
      input.fallbackReason ??
      null,
  }
}

// El fallo de red ya lo logueó `graphRequest` con su `step` y su motivo, así que
// acá sólo se traduce. Cualquier otra excepción se vuelve a lanzar: sería un bug
// nuestro y disfrazarlo de «Meta no contestó» mandaría a investigar a Meta.
function networkFailure(error: unknown): WhatsappTemplateApiFailure {
  if (!(error instanceof WhatsappApiError)) throw error
  return {
    ok: false,
    status: 502,
    metaErrorCode: null,
    error: "Could not reach Meta's Graph API (network error or timeout)",
    reason:
      "Resender couldn't reach Meta to manage this template. Retry in a moment — if the call never left, nothing changed in your WhatsApp Business account.",
  }
}

// La edición y el borrado contestan `{ "success": true }`. Se toma el HTTP como
// veredicto y sólo un `success: false` **explícito** contradice un 2xx: exigir
// `success === true` haría que un 200 con otra forma se reportara como fallo de
// una operación que sí se aplicó, y en el borrado eso manda al cliente a
// reintentar algo irreversible que ya ocurrió.
function readMutationResult(input: {
  action: LogAction
  wabaId?: string
  name?: string
  status: number
  ok: boolean
  data: Record<string, unknown>
}): WhatsappTemplateMutationResult {
  if (input.ok && input.data.success !== false) return { ok: true }

  return graphFailure({
    action: input.action,
    wabaId: input.wabaId,
    name: input.name,
    status: input.status,
    data: input.data,
    fallbackError: "Meta rejected the template operation",
  })
}

// Meta acompaña muchos errores de administración con un título y un texto
// escritos para mostrarle a una persona. No están en `extractMetaErrorMessage`
// —que lee el `message` técnico— y se leen acá y no en `meta-send.ts` porque es
// esta superficie la que los recibe: los errores de envío casi nunca los traen.
function readUserMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const error = (data as Record<string, unknown>).error
  if (!error || typeof error !== "object") return null
  const record = error as Record<string, unknown>

  const message = readString(record.error_user_msg)
  if (!message) return null
  const title = readString(record.error_user_title)
  return title ? `${title}: ${message}` : message
}

// Devuelve además **cuántas filas se descartaron**. El descarte es correcto
// —una fila sin identidad no se puede espejar— pero mudo no puede ser: sin el
// conteo, `templates.length` no se puede contrastar con lo que Meta dice tener,
// y el día que la respuesta cambie de forma el sync escribiría cero plantillas
// informando `ok`.
function readTemplates(data: Record<string, unknown>): {
  templates: WhatsappGraphTemplate[]
  dropped: number
} {
  const rows = Array.isArray(data.data) ? data.data : []
  const templates: WhatsappGraphTemplate[] = []
  let dropped = 0

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      dropped += 1
      continue
    }
    const record = row as Record<string, unknown>
    const id = readString(record.id)
    const name = readString(record.name)
    const language = readString(record.language)
    const status = readString(record.status)
    // Los cuatro son la identidad y el estado: una fila a la que le falte
    // alguno no se puede espejar —el unique del espejo es `(waba, name,
    // language)`— y descartarla es mejor que insertar una fila rota que después
    // el gate del envío tiene que interpretar.
    if (!id || !name || !language || !status) {
      dropped += 1
      continue
    }
    templates.push({
      id,
      name,
      language,
      status,
      category: readCategory(record.category),
    })
  }

  return { templates, dropped }
}

// Ver `paging` en el comentario de `listWhatsappTemplatesInGraph`: `next` dice
// si hay otra página, `cursors.after` dice con qué pedirla, y hacen falta los
// dos.
//
// **Son tres respuestas y no dos**, y por eso no devuelve `string | null`: «no
// hay más páginas» y «hay más y no sé pedirlas» son estados opuestos que un
// `null` juntaba en el mismo camino, el del catálogo completo. Con `next`
// presente y `cursors.after` ilegible, el paginador terminaba diciendo
// `truncated: false` sobre una sola página —el sync lo logueaba como `ok`— y
// ésa es exactamente la mentira silenciosa que `truncated` existe para evitar.
type NextPage =
  | { kind: "end" }
  | { kind: "unreadable" }
  | { kind: "cursor"; after: string }

function readNextCursor(data: Record<string, unknown>): NextPage {
  const paging = data.paging
  if (!paging || typeof paging !== "object") return { kind: "end" }
  const record = paging as Record<string, unknown>
  // Sin `next` no hay página siguiente, aunque venga `cursors.after`: en la
  // última página Meta lo manda igual.
  if (!readString(record.next)) return { kind: "end" }

  const cursors = record.cursors
  if (!cursors || typeof cursors !== "object") return { kind: "unreadable" }
  const after = readString((cursors as Record<string, unknown>).after)
  return after ? { kind: "cursor", after } : { kind: "unreadable" }
}

// Meta habla en mayúsculas (`UTILITY`) y el check de la 0018 guarda en
// minúsculas. La vuelta —lo que Graph dice, normalizado a lo que la base
// acepta— la hace `normalizeWhatsappTemplateCategory` del espejo, y se reusa en
// vez de reescribirse: el webhook ya la necesitaba, y dos normalizadores del
// mismo catálogo se desincronizan el día que aparezca una categoría nueva.
function toGraphCategory(category: WhatsappTemplateCategory): string {
  return category.toUpperCase()
}

function readCategory(value: unknown): WhatsappTemplateCategory | null {
  return normalizeWhatsappTemplateCategory(readString(value))
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}
