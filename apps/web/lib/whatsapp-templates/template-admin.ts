import {
  authenticateApiKey,
  type AuthenticatedApiKey,
} from "@/lib/api-keys/api-keys"
import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import {
  createWhatsappTemplateInGraph,
  deleteWhatsappTemplateInGraph,
  updateWhatsappTemplateInGraph,
  type WhatsappTemplateApiFailure,
  type WhatsappTemplateComponent,
} from "@/lib/meta/whatsapp-template-client"
import {
  describeError,
  log,
  type LogAction,
  type LogReason,
} from "@/lib/observability/logger"
import { getBearerToken } from "@/lib/outbound/send-request"
import { getActivePageWithTokenForTenant } from "@/lib/pages/page-registry"
import {
  createWhatsappTemplateMirror,
  deleteWhatsappTemplate,
  getWhatsappTemplateById,
  listWhatsappTemplates,
  normalizeWhatsappTemplateCategory,
  type WhatsappTemplateCategory,
  type WhatsappTemplateRecord,
  type WhatsappTemplateStatus,
} from "@/lib/whatsapp-templates/template-registry"

// **La administración del catálogo de plantillas** (ADR 0014): listar, crear,
// editar y borrar una [Plantilla] en la WABA del cliente, con la comprobación
// de propiedad que decide qué se puede tocar y qué es de sólo lectura.
//
// **Por qué esto no vive en las rutas.** La pantalla de la consola hace
// exactamente lo mismo que `/api/meta/whatsapp/templates`, pero desde Server
// Actions que llaman a `lib/*` directo: así funciona toda la consola desde la
// ADR 0012 —un solo Worker, sin fetch a la propia API pública—. Si la
// orquestación —resolver la WABA del número, comprobar la propiedad de la fila,
// llamar a Graph, espejar el resultado— viviera en los route handlers, la
// consola tendría que reescribirla entera, y dos copias de una regla de
// propiedad no divergen de golpe: divergen el día que alguien arregla una sola.
// El precio de un `PATCH` que se olvida de comprobar `created_by_tenant_id` es
// que un tenant edite la plantilla de otro en una WABA compartida.
//
// Por eso todo lo de acá devuelve **resultados discriminados y no lanza**: la
// ruta traduce el fallo a HTTP con `templateAdminFailureResponse`, y la Server
// Action lee los mismos campos para pintar el estado del formulario. El
// `status` y el `error` viajan en el resultado porque la decisión de qué código
// corresponde es del dominio y no del transporte: «esta plantilla es ajena» es
// un 403 lo pida quien lo pida.
//
// **Lo que este módulo no hace es decidir un envío.** Eso es `template-gate.ts`,
// que es puro y falla abierto. Acá el espejo sí manda en un caso —el `GET` lee
// de la base y no de Graph—, y es el único: listar no envía nada, así que una
// lista con un minuto de retraso no le cuesta nada a nadie, mientras que pedirle
// el catálogo a Meta en cada pintada de pantalla gastaría una llamada de rate
// limit por cada F5.

// ---------------------------------------------------------------------------
// Los resultados
// ---------------------------------------------------------------------------

/**
 * Un rechazo, con todo lo que hace falta para contestarlo y para registrarlo.
 *
 * `error` es el código estable —lo que un cliente puede comparar— y `message`
 * el texto que se le muestra a una persona. `reason` es del log y no de la
 * respuesta: son dos vocabularios distintos a propósito, porque el catálogo de
 * `LogReason` es una unión cerrada que se comparte con el resto del worker y no
 * tiene por qué seguir a la API pública.
 */
export type TemplateAdminFailure = {
  ok: false
  status: number
  error: string
  message: string
  reason: LogReason
  // `dropped` es «lo rechazamos nosotros y está todo bien»; `failed` es «algo
  // se rompió o Meta dijo que no». Separan el nivel del log: un cliente que
  // pide una plantilla ajena no es una alarma, un 500 de Graph sí.
  outcome: "dropped" | "failed"
  metaErrorCode?: number | null
}

/**
 * Una plantilla como la ve el cliente de la API y la pantalla de la consola.
 *
 * `own` es el campo por el que existe todo este módulo: marca las que el tenant
 * creó desde Resender, que son las únicas que puede editar y borrar. Las demás
 * se listan igual —el catálogo es de la WABA y esconderlas produciría una lista
 * que miente sobre lo que ese número puede enviar (ADR 0014)— pero son de sólo
 * lectura.
 */
export type TemplateAdminView = {
  id: string
  name: string
  language: string
  // Normalizado al catálogo cerrado del espejo. Es con lo que se decide.
  status: WhatsappTemplateStatus
  // Sólo cuando el normalizado es `unknown`, y ahí es el único dato útil: Meta
  // agrega estados sin cambiar de versión de API, y un `unknown` a secas no le
  // permite al cliente ni buscarlo en WhatsApp Manager. Publicarlo siempre
  // obligaría a todo el mundo a elegir cuál de los dos mirar.
  rawStatus?: string
  category: WhatsappTemplateCategory | null
  metaTemplateId: string | null
  own: boolean
  createdAt: string
  syncedAt: string
}

export type ListTemplatesResult =
  | { ok: true; wabaId: string; templates: TemplateAdminView[] }
  | TemplateAdminFailure

export type CreateTemplateResult =
  | {
      ok: true
      template: TemplateAdminView
      // `false` significa «Meta la creó y nuestro espejo no se enteró». No es
      // un fallo del pedido —la plantilla existe y se puede enviar— y por eso
      // no se convierte en error; viaja como dato para que quien llame no
      // presente como espejado algo que no lo está. El sync la recupera.
      mirrored: boolean
    }
  | TemplateAdminFailure

export type UpdateTemplateResult =
  | {
      ok: true
      template: TemplateAdminView
      // Siempre `true`: Meta revisa **toda** plantilla editada, aprobada o no.
      // Va explícito en la respuesta porque es la consecuencia que el cliente
      // no ve venir —la plantilla deja de poder enviarse hasta la re-aprobación—
      // y porque el aviso de la pantalla necesita un dato del que colgarse.
      returnsToReview: true
      message: string
    }
  | TemplateAdminFailure

export type DeleteTemplateResult =
  | { ok: true; id: string; name: string; language: string }
  | TemplateAdminFailure

// ---------------------------------------------------------------------------
// Los gates
// ---------------------------------------------------------------------------

export type TemplateAdminGatesResult =
  | { ok: true; apiKey: AuthenticatedApiKey }
  | { ok: false; response: Response }

/**
 * La antesala de las cuatro rutas de administración: API key, permiso de canal,
 * waitlist y suscripción activa, en ese orden.
 *
 * **Es la secuencia del envío menos los gates de mensajería**, y las ausencias
 * son la parte que hay que leer:
 *
 *   - **sin `Idempotency-Key`.** No son operaciones de mensajería: no hay nada
 *     que le llegue al teléfono de nadie, y el único efecto no idempotente
 *     —crear— ya lo rechaza Meta por su cuenta, porque el nombre de una
 *     plantilla es único en la WABA. Exigirla sería pedirle al cliente una
 *     ceremonia que no compra nada.
 *   - **sin cuota ni entitlement.** La cuota cuenta [Mensaje contabilizado]s y
 *     acá no se envía ninguno. Descontar una plantilla creada del mismo
 *     contador convertiría «administré mi catálogo» en «me quedé sin mensajes».
 *   - **sin conversación y sin ventana de atención.** No hay destinatario. La
 *     ventana es una regla de envío y no tiene nada que decir sobre un catálogo.
 *
 * **La suscripción activa sí se exige**, y es la única de las cuatro que podría
 * discutirse: crear una plantilla deja un efecto permanente en la WABA del
 * cliente —cuenta contra el tope de 6.000, y su nombre queda tomado— y no
 * queremos eso disponible para una cuenta que dejó de pagar. Se aplica también
 * al `GET`, que no deja efecto: partir el gate por método haría que la pantalla
 * de plantillas se cargue a medias para un moroso, que es peor experiencia que
 * el 403 entero.
 *
 * `runWhatsappSendGates` **no** se reusa a propósito: trae la `Idempotency-Key`
 * obligatoria y la cuota, que son justamente los dos que acá sobran.
 *
 * Vive en este módulo y no en las rutas porque son tres archivos de ruta y una
 * secuencia sola. La consola **no** la usa: se autentica con `auth()` de la
 * sesión, no con una API key, y sus propios gates son los de la pantalla.
 */
export async function runWhatsappTemplateAdminGates(input: {
  request: Request
  action: LogAction
  requestId: string
}): Promise<TemplateAdminGatesResult> {
  const { request, action, requestId } = input

  // ---- 1. API key ---------------------------------------------------------
  // Antes que cualquier otra cosa: un 401 no le cuenta a un desconocido si el
  // tenant existe ni qué canales tiene.
  const apiKey = await authenticateApiKey(
    getBearerToken(request.headers.get("authorization"))
  )
  if (!apiKey) {
    return {
      ok: false,
      response: templateAdminFailureResponse(
        {
          ok: false,
          status: 401,
          error: "unauthorized",
          message: "A valid Resender API key is required.",
          reason: "unauthorized",
          outcome: "dropped",
        },
        { action, requestId }
      ),
    }
  }

  // ---- 2. Permiso de canal (ADR 0010) -------------------------------------
  // El `error` es el mismo código genérico que usan los envíos: la misma API
  // key sirve para los otros canales y un cliente que ya distingue este caso en
  // Messenger no tiene por qué aprender un código nuevo. Es el `message` el que
  // nombra a WhatsApp.
  if (!(await resolveWhatsappAccess(apiKey.tenantId))) {
    return {
      ok: false,
      response: templateAdminFailureResponse(
        {
          ok: false,
          status: 403,
          error: "channel_not_enabled",
          message: "whatsapp channel is not enabled",
          reason: "channel_not_enabled",
          outcome: "dropped",
        },
        { action, requestId, tenantId: apiKey.tenantId }
      ),
    }
  }

  // ---- 3. Waitlist --------------------------------------------------------
  if (await isUserWaitlisted(apiKey.tenantId)) {
    return {
      ok: false,
      response: templateAdminFailureResponse(
        {
          ok: false,
          status: 403,
          error: "waitlisted",
          message: "This account is on the waitlist.",
          reason: "waitlisted",
          outcome: "dropped",
        },
        { action, requestId, tenantId: apiKey.tenantId }
      ),
    }
  }

  // ---- 4. Suscripción activa ----------------------------------------------
  if (!(await hasActiveSubscription(apiKey.tenantId))) {
    return {
      ok: false,
      response: templateAdminFailureResponse(
        {
          ok: false,
          status: 403,
          error: "no_active_subscription",
          message:
            "An active subscription is required to manage WhatsApp templates.",
          reason: "no_active_subscription",
          outcome: "dropped",
        },
        { action, requestId, tenantId: apiKey.tenantId }
      ),
    }
  }

  return { ok: true, apiKey }
}

// ---------------------------------------------------------------------------
// GET: el catálogo del número
// ---------------------------------------------------------------------------

/**
 * El catálogo de plantillas del número, **leído del espejo**.
 *
 * No llama a Graph, y es el único lugar de la entrega donde el espejo es la
 * fuente. Es aceptable porque listar no envía nada: lo peor que produce un
 * espejo con retraso acá es una fila que falta en una pantalla, mientras que
 * consultarle el catálogo a Meta en cada pintada gastaría rate limit del
 * cliente por cada recarga. El `status` lo mantiene fresco el webhook.
 *
 * Devuelve **todo el catálogo de la WABA**, incluidas las plantillas de otros
 * tenants que comparten esa WABA. Es una decisión, no un descuido (ADR 0014):
 * el número puede enviarlas todas, y una lista filtrada mentiría sobre lo que
 * ese número puede hacer. Quién puede editarlas es otra pregunta, y la contesta
 * `own`.
 */
export async function listWhatsappTemplatesForTenant(input: {
  tenantId: string
  pageId: string
}): Promise<ListTemplatesResult> {
  const resolved = await resolveWhatsappNumber(input)
  if (!resolved.ok) return resolved

  const templates = await listWhatsappTemplates({ wabaId: resolved.wabaId })

  return {
    ok: true,
    wabaId: resolved.wabaId,
    templates: templates.map((template) =>
      toTemplateAdminView(template, input.tenantId)
    ),
  }
}

// ---------------------------------------------------------------------------
// POST: crear en Meta y espejar
// ---------------------------------------------------------------------------

/**
 * Crea la plantilla en la WABA del número y espeja la fila.
 *
 * El orden es Meta primero y espejo después, y no al revés: la fila del espejo
 * describe una plantilla **que existe en Meta**, y escribirla antes dejaría el
 * catálogo anunciando plantillas que un fallo de Graph nunca llegó a crear. Por
 * eso `createdByTenantId` sólo se escribe cuando Meta ya dijo que sí.
 *
 * Los límites de Meta —6.000 plantillas por WABA, 100 creaciones por hora— no
 * se modelan acá: no hay contador nuestro que llevar (ADR 0014). El día que se
 * choque contra uno, lo dice Graph y su error ya viene traducido en `reason`.
 */
export async function createWhatsappTemplateForTenant(input: {
  tenantId: string
  pageId: string
  name: string
  language: string
  category: WhatsappTemplateCategory
  components: WhatsappTemplateComponent[]
}): Promise<CreateTemplateResult> {
  const resolved = await resolveWhatsappNumber(input)
  if (!resolved.ok) return resolved

  const created = await createWhatsappTemplateInGraph({
    accessToken: resolved.accessToken,
    wabaId: resolved.wabaId,
    name: input.name,
    language: input.language,
    category: input.category,
    components: input.components,
  })

  if (!created.ok) {
    return fromGraphFailure(created, "template_create_failed")
  }

  // El estado va **crudo**, tal cual lo dijo Meta: la columna no tiene check y
  // normalizar de ida convertiría un estado nuevo en `unknown` para siempre.
  // La categoría, en cambio, es la que Meta confirmó y no la que pidió el
  // formulario: son la misma salvo que Meta reclasifique, y guardar la pedida
  // dejaría el espejo discutiéndole a Meta sobre algo que se factura distinto.
  try {
    const mirrored = await createWhatsappTemplateMirror({
      wabaId: resolved.wabaId,
      name: input.name,
      language: input.language,
      status: created.status,
      category: created.category ?? input.category,
      metaTemplateId: created.id,
      createdByTenantId: input.tenantId,
    })

    return {
      ok: true,
      template: toTemplateAdminView(mirrored, input.tenantId),
      mirrored: true,
    }
  } catch (error) {
    // **La plantilla ya existe en Meta.** Devolver un error acá sería la peor
    // respuesta posible: el cliente reintentaría, Meta rechazaría el nombre
    // duplicado, y él terminaría creyendo que no tiene una plantilla que sí
    // tiene y cuyo nombre además ya quemó. Así que se contesta el éxito que
    // realmente ocurrió, con `mirrored: false` para que nadie lo confunda con
    // una fila escrita, y se deja la línea de log porque un espejo que falla en
    // silencio se descubre semanas después: mientras tanto la plantilla se ve
    // ajena y no se puede editar ni borrar desde acá.
    log({
      entrypoint: "route",
      action: "template_create",
      outcome: "failed",
      reason: "internal_error",
      tenantId: input.tenantId,
      connectionId: resolved.connectionId,
      channel: "whatsapp",
      accountId: resolved.metaPageId,
      templateName: input.name,
      templateLanguage: input.language,
      errorMessage: describeError(error),
    })

    return {
      ok: true,
      mirrored: false,
      template: {
        id: created.id,
        name: input.name,
        language: input.language,
        status: "unknown",
        rawStatus: created.status,
        category: created.category ?? input.category,
        metaTemplateId: created.id,
        own: true,
        createdAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      },
    }
  }
}

// ---------------------------------------------------------------------------
// PATCH: editar en Meta
// ---------------------------------------------------------------------------

/**
 * Edita el contenido de una plantilla propia.
 *
 * **Editar una aprobada se permite**, con aviso. Prohibirlo llenaría la WABA de
 * `nombre_v2` y `_v3` contra un tope de 6.000, y la consecuencia de editar es
 * reversible: Meta la vuelve a revisar y se re-aprueba sola (ADR 0014).
 *
 * **No se toca el `status` del espejo.** Es tentador escribir `PENDING` acá —la
 * plantilla efectivamente vuelve a revisión— y sería un error: el webhook de
 * Meta puede llegar antes de que termine este request, y nuestro `update`
 * pisaría con un `PENDING` inventado el `APPROVED` que Meta ya confirmó. La
 * fila quedaría bloqueando envíos legítimos —el gate del envío sólo falla
 * abierto cuando la fila **no está**— hasta el próximo sync. El estado lo
 * escribe una sola fuente, que es el webhook; nosotros devolvemos
 * `returnsToReview` para que el cliente sepa qué esperar.
 */
export async function updateWhatsappTemplateForTenant(input: {
  tenantId: string
  pageId: string
  templateId: string
  components: WhatsappTemplateComponent[]
  category?: WhatsappTemplateCategory
}): Promise<UpdateTemplateResult> {
  const owned = await resolveOwnTemplate(input)
  if (!owned.ok) return owned

  const { template, accessToken } = owned

  // Sin hsm id no hay a qué nodo de Graph pegarle: el edge de edición es un
  // `POST` sobre `/{template_id}`, y no existe una versión por nombre.
  const metaTemplateId = template.metaTemplateId?.trim()
  if (!metaTemplateId) {
    return {
      ok: false,
      status: 409,
      error: "template_missing_meta_id",
      message:
        "Resender doesn't know this template's Meta id, so it cannot be edited from here. Edit it in WhatsApp Manager.",
      reason: "template_missing_meta_id",
      outcome: "dropped",
    }
  }

  const updated = await updateWhatsappTemplateInGraph({
    accessToken,
    metaTemplateId,
    components: input.components,
    ...(input.category ? { category: input.category } : {}),
  })

  if (!updated.ok) {
    return fromGraphFailure(updated, "template_update_failed")
  }

  return {
    ok: true,
    template: toTemplateAdminView(template, input.tenantId),
    returnsToReview: true,
    message:
      "WhatsApp reviews every edited template again, so this template cannot be sent until it is approved once more. This usually takes up to 24 hours.",
  }
}

// ---------------------------------------------------------------------------
// DELETE: borrar en Meta por hsm id, y recién entonces el espejo
// ---------------------------------------------------------------------------

/**
 * Borra una plantilla propia, **siempre por `hsm_id`**.
 *
 * Es la operación más destructiva de la API pública y la única que no se puede
 * deshacer ni esperando: borrar por `name` —la otra forma que ofrece Meta— se
 * lleva **todas** las versiones de idioma de esa plantilla y deja el nombre
 * quemado 30 días. Por eso, cuando a la fila le falta el `meta_template_id`,
 * esto **rechaza con un error que lo explica** en vez de caer al borrado por
 * nombre: el fallback sería exactamente el desastre que la regla evita, y
 * disfrazado de comodidad.
 *
 * El espejo se borra **después** y sólo si Meta aceptó. Al revés, un fallo de
 * Graph nos dejaría sin la fila y por lo tanto sin el hsm id, que es lo único
 * con lo que se puede reintentar.
 */
export async function deleteWhatsappTemplateForTenant(input: {
  tenantId: string
  pageId: string
  templateId: string
}): Promise<DeleteTemplateResult> {
  const owned = await resolveOwnTemplate(input)
  if (!owned.ok) return owned

  const { template, accessToken, wabaId } = owned

  const hsmId = template.metaTemplateId?.trim()
  if (!hsmId) {
    return {
      ok: false,
      status: 409,
      error: "template_missing_meta_id",
      message:
        "Resender doesn't know this template's Meta id, and deleting by name would delete every language version of it and block the name for 30 days. Delete this template from WhatsApp Manager instead.",
      reason: "template_missing_meta_id",
      outcome: "dropped",
    }
  }

  const deleted = await deleteWhatsappTemplateInGraph({
    accessToken,
    wabaId,
    hsmId,
    name: template.name,
  })

  if (!deleted.ok) {
    // El espejo queda intacto: la plantilla sigue existiendo en Meta y una fila
    // borrada acá la volvería invisible e imborrable desde Resender.
    return fromGraphFailure(deleted, "template_delete_failed")
  }

  await deleteWhatsappTemplate(template.id)

  return {
    ok: true,
    id: template.id,
    name: template.name,
    language: template.language,
  }
}

// ---------------------------------------------------------------------------
// El parseo del cuerpo — puro, sin red y sin base
// ---------------------------------------------------------------------------

/**
 * Las categorías que el editor ofrece.
 *
 * `authentication` queda fuera **a propósito** y no por olvido: tiene forma
 * restringida, reglas de OTP propias y un flujo de botones que el editor v1 no
 * hace. Es un producto aparte, no una opción más del `select` (ADR 0014). El
 * espejo sí la conoce, porque el sync puede traer plantillas de esa categoría
 * creadas en WhatsApp Manager.
 */
export const WHATSAPP_TEMPLATE_EDITABLE_CATEGORIES = [
  "utility",
  "marketing",
] as const

export type WhatsappTemplateEditableCategory =
  (typeof WHATSAPP_TEMPLATE_EDITABLE_CATEGORIES)[number]

export type TemplateInputResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; message: string }

export type WhatsappTemplateDraft = {
  pageId: string
  name: string
  language: string
  category: WhatsappTemplateEditableCategory
  components: WhatsappTemplateComponent[]
}

export type WhatsappTemplateEdit = {
  pageId: string
  components: WhatsappTemplateComponent[]
  category?: WhatsappTemplateEditableCategory
}

/**
 * El cuerpo del `POST`: identidad de la plantilla, categoría y componentes.
 *
 * **Qué se valida y qué no.** La regla general de esta entrega es que Meta
 * decide: no contamos parámetros en el envío porque un falso rechazo nuestro es
 * peor que uno de Meta —contra el nuestro el cliente no puede hacer nada—. Acá
 * se valida más, y por un motivo concreto: lo que se comprueba son las tres
 * reglas de forma que Meta rechaza **siempre y de inmediato**, con un mensaje
 * suyo que no dice qué arreglar. Adelantarlas no cierra ninguna puerta que Meta
 * fuera a abrir; sólo cambia un rechazo opaco por uno que nombra el campo.
 */
export function parseWhatsappTemplateDraft(
  body: unknown
): TemplateInputResult<WhatsappTemplateDraft> {
  if (!body || typeof body !== "object") {
    return invalid("invalid_request", "The request body must be a JSON object.")
  }
  const raw = body as Record<string, unknown>

  const pageId = readString(raw.pageId)
  if (!pageId) {
    return invalid(
      "invalid_request",
      "pageId is required: it is the WhatsApp phone number id the template belongs to."
    )
  }

  // El nombre lo fija Meta y no nosotros: minúsculas, dígitos y guiones bajos,
  // hasta 512 caracteres. Es una regla estable y su incumplimiento es un
  // rechazo garantizado, así que comprobarla acá le ahorra al cliente un viaje
  // de ida y vuelta contra un error de Graph que no nombra el campo.
  const name = readString(raw.name)
  if (!name || !/^[a-z0-9_]{1,512}$/.test(name)) {
    return invalid(
      "invalid_template_name",
      "name is required and can only contain lowercase letters, digits and underscores (up to 512 characters)."
    )
  }

  // El idioma no se valida contra un catálogo: el de Meta es largo, cambia, y
  // una lista nuestra desactualizada rechazaría un idioma que Meta acepta. Se
  // exige que esté, nada más; la forma canónica la impone el espejo.
  const language = readString(raw.language)
  if (!language) {
    return invalid(
      "invalid_template_language",
      'language is required, as a WhatsApp language code such as "es" or "en_US".'
    )
  }

  const category = readEditableCategory(raw.category)
  if (!category) {
    return invalid(
      "invalid_template_category",
      'category must be "utility" or "marketing". Authentication templates are managed in WhatsApp Manager.'
    )
  }

  const components = parseTemplateComponents(raw.components)
  if (!components.ok) return components

  return {
    ok: true,
    value: { pageId, name, language, category, components: components.value },
  }
}

/**
 * El cuerpo del `PATCH`: sólo lo que Meta deja editar.
 *
 * `name` y `language` no se aceptan porque son la **identidad** de la
 * plantilla: cambiarlos no sería editarla sino crear otra, y el edge de edición
 * de Meta tampoco lo confirma. Un `name` en el cuerpo se ignora en silencio en
 * vez de rechazarse, para no romper a un cliente que reenvía el objeto entero
 * que le devolvió el `GET`.
 */
export function parseWhatsappTemplateEdit(
  body: unknown
): TemplateInputResult<WhatsappTemplateEdit> {
  if (!body || typeof body !== "object") {
    return invalid("invalid_request", "The request body must be a JSON object.")
  }
  const raw = body as Record<string, unknown>

  const pageId = readString(raw.pageId)
  if (!pageId) {
    return invalid(
      "invalid_request",
      "pageId is required: it is the WhatsApp phone number id the template belongs to."
    )
  }

  const components = parseTemplateComponents(raw.components)
  if (!components.ok) return components

  // La categoría es opcional al editar: omitirla es «dejala como está», que es
  // lo que quiere casi todo el mundo. Si viene, se valida igual que al crear.
  if (raw.category === undefined || raw.category === null) {
    return { ok: true, value: { pageId, components: components.value } }
  }

  const category = readEditableCategory(raw.category)
  if (!category) {
    return invalid(
      "invalid_template_category",
      'category must be "utility" or "marketing". Authentication templates are managed in WhatsApp Manager.'
    )
  }

  return { ok: true, value: { pageId, components: components.value, category } }
}

/**
 * Los componentes del editor v1: un `BODY` obligatorio y un `FOOTER` opcional.
 *
 * La única validación de contenido es la de los ejemplos, y es la que más
 * paga: Meta exige un valor de ejemplo por cada variable del cuerpo y sin ellos
 * el rechazo es **automático**, con un error de forma que no dice cuál falta.
 * El formulario los pide justamente por eso, y esta función es lo que impide
 * que la API pública acepte lo que la pantalla no deja mandar.
 *
 * Se cuentan las variables posicionales (`{{1}}`, `{{2}}`) y no las nombradas:
 * las nombradas son un formato más nuevo con su propio campo de ejemplos, y
 * contarlas con este regex daría cero, que es exactamente lo que hace falta
 * para no rechazarlas por una regla que no les aplica.
 */
function parseTemplateComponents(
  raw: unknown
): TemplateInputResult<WhatsappTemplateComponent[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return invalid(
      "invalid_template_components",
      "components must be a non-empty array with one BODY component and an optional FOOTER."
    )
  }

  const components: WhatsappTemplateComponent[] = []
  let bodies = 0
  let footers = 0

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return invalid(
        "invalid_template_components",
        'Every component must be an object with a type of "BODY" or "FOOTER".'
      )
    }
    const component = entry as Record<string, unknown>
    // El tipo se compara en mayúsculas porque Meta lo escribe así y un
    // `"body"` en minúscula es un descuido de tipeo, no una intención distinta.
    const type = readString(component.type)?.toUpperCase()
    const text = readString(component.text)

    if (type === "BODY") {
      bodies += 1
      // 1024 es el máximo del cuerpo según la referencia de componentes.
      if (!text || text.length > 1024) {
        return invalid(
          "invalid_template_components",
          "The BODY component needs a text of between 1 and 1024 characters."
        )
      }

      const examples = readBodyExamples(component.example)
      const variables = countPositionalVariables(text)
      if (variables > 0 && examples.length < variables) {
        return invalid(
          "missing_variable_examples",
          `The BODY has ${variables} variable(s), so it needs an example value for each one in example.body_text[0]. WhatsApp rejects templates with missing examples without reviewing them.`
        )
      }

      components.push({
        type: "BODY",
        text,
        // El ejemplo es un array **de arrays**: Meta modela ahí un conjunto de
        // juegos de valores, y mandarlo plano es el error de forma más común
        // del endpoint. Se rearma acá para que un cliente que mandó el array
        // simple no descubra la anidación leyendo un 400 de Graph.
        ...(examples.length > 0 ? { example: { body_text: [examples] } } : {}),
      })
      continue
    }

    if (type === "FOOTER") {
      footers += 1
      // 60 es el máximo del pie, y no admite variables.
      if (!text || text.length > 60) {
        return invalid(
          "invalid_template_components",
          "The FOOTER component needs a text of between 1 and 60 characters."
        )
      }
      components.push({ type: "FOOTER", text })
      continue
    }

    // Headers y botones caen acá, y el mensaje lo dice: no son un campo que
    // falte implementar sino alcance cerrado del editor v1 (ADR 0014).
    return invalid(
      "invalid_template_components",
      "Only BODY and FOOTER components are supported. Headers and buttons are managed in WhatsApp Manager."
    )
  }

  if (bodies !== 1) {
    return invalid(
      "invalid_template_components",
      "components must contain exactly one BODY component."
    )
  }
  if (footers > 1) {
    return invalid(
      "invalid_template_components",
      "components can contain at most one FOOTER component."
    )
  }

  return { ok: true, value: components }
}

// ---------------------------------------------------------------------------
// La traducción a HTTP
// ---------------------------------------------------------------------------

/**
 * Convierte un rechazo del dominio en la respuesta de la API, y lo registra.
 *
 * Las dos cosas juntas y en una sola función porque es la única forma de que no
 * exista un camino que conteste sin loguear: el catálogo de motivos es cerrado
 * justamente para que «por qué falló esto» sea un filtro y no una lectura de
 * texto. La usan las tres rutas; la Server Action de la consola no, porque
 * necesita estado de formulario y no una `Response`, y por eso los campos del
 * fallo son datos y no una respuesta ya armada.
 */
export function templateAdminFailureResponse(
  failure: TemplateAdminFailure,
  context: {
    action: LogAction
    requestId: string
    tenantId?: string
    connectionId?: string
    accountId?: string
    // El nombre de la plantilla se puede loguear. Los `components` **no**: son
    // datos del cliente final —nombres, importes, códigos— y valen lo mismo que
    // el texto de un mensaje, que este producto no escribe en logs.
    templateName?: string
    templateLanguage?: string
  }
): Response {
  log({
    entrypoint: "route",
    action: context.action,
    outcome: failure.outcome,
    reason: failure.reason,
    requestId: context.requestId,
    channel: "whatsapp",
    ...(context.tenantId ? { tenantId: context.tenantId } : {}),
    ...(context.connectionId ? { connectionId: context.connectionId } : {}),
    ...(context.accountId ? { accountId: context.accountId } : {}),
    ...(context.templateName ? { templateName: context.templateName } : {}),
    ...(context.templateLanguage
      ? { templateLanguage: context.templateLanguage }
      : {}),
    status: failure.status,
    errorCode: failure.metaErrorCode ?? failure.error,
  })

  return Response.json(
    { error: failure.error, message: failure.message },
    { status: failure.status }
  )
}

// ---------------------------------------------------------------------------
// Interno
// ---------------------------------------------------------------------------

type ResolvedNumber = {
  ok: true
  wabaId: string
  accessToken: string
  connectionId: string
  metaPageId: string
}

// Toda operación empieza igual: del `pageId` público —el `phone_number_id`— al
// token y a la WABA. **La WABA nunca la manda el cliente**: toda la API pública
// es orientada al número, y pedirle su WABA sería filtrarle un identificador
// que además comparte con otros tenants. El canal va explícito porque
// `meta_page_id` es único por `(channel, meta_page_id)` desde la 0013 y buscar
// sin él puede traer la fila de otro canal.
async function resolveWhatsappNumber(input: {
  tenantId: string
  pageId: string
}): Promise<ResolvedNumber | TemplateAdminFailure> {
  const connected = await getActivePageWithTokenForTenant(
    input.tenantId,
    input.pageId,
    "whatsapp"
  )

  if (!connected) {
    return {
      ok: false,
      status: 404,
      error: "page_not_connected",
      message: "WhatsApp number is not connected for this tenant",
      reason: "page_not_connected",
      outcome: "dropped",
    }
  }

  // Una conexión de WhatsApp sin WABA es una anomalía de datos y no un estado
  // normal —la 0013 la escribe al conectar—, pero acá no se puede seguir
  // adivinando: la plantilla vive en la WABA, así que sin ella no hay ni
  // catálogo que leer ni nodo de Graph al que pegarle.
  if (!connected.page.wabaId) {
    return {
      ok: false,
      status: 409,
      error: "waba_not_resolved",
      message:
        "This WhatsApp number has no WhatsApp Business Account on record. Reconnect the number in Resender.",
      reason: "missing_waba_id",
      outcome: "failed",
    }
  }

  return {
    ok: true,
    wabaId: connected.page.wabaId,
    accessToken: connected.pageAccessToken,
    connectionId: connected.page.id,
    metaPageId: connected.page.metaPageId,
  }
}

type ResolvedOwnTemplate = ResolvedNumber & {
  template: WhatsappTemplateRecord
}

/**
 * La comprobación que separa «puedo verla» de «puedo tocarla».
 *
 * Tres preguntas, en este orden, y las tres importan:
 *
 * 1. **¿la fila existe?** → 404.
 * 2. **¿es de una WABA de este tenant?** → 404 también, y a propósito: una fila
 *    de otra WABA no debe ser ni siquiera direccionable, y contestar 403 le
 *    confirmaría a quien prueba ids que esa plantilla existe. El id es un uuid,
 *    así que nadie llega ahí por accidente.
 * 3. **¿la creó este tenant desde Resender?** → si no, 403 **diciendo dónde se
 *    administra**. Este es distinto de los otros dos: la plantilla es visible en
 *    el `GET` del cliente, así que negarla sin explicación lo dejaría adivinando
 *    por qué una fila que ve no se deja editar. Las importadas por el sync y las
 *    que perdieron dueño son de sólo lectura, y su lugar de edición es WhatsApp
 *    Manager.
 */
async function resolveOwnTemplate(input: {
  tenantId: string
  pageId: string
  templateId: string
}): Promise<ResolvedOwnTemplate | TemplateAdminFailure> {
  const resolved = await resolveWhatsappNumber(input)
  if (!resolved.ok) return resolved

  const template = await getWhatsappTemplateById(input.templateId)

  if (!template || template.wabaId !== resolved.wabaId) {
    return {
      ok: false,
      status: 404,
      error: "template_not_found",
      message: "This template does not exist for this WhatsApp number.",
      reason: "template_not_found",
      outcome: "dropped",
    }
  }

  if (template.createdByTenantId !== input.tenantId) {
    return {
      ok: false,
      status: 403,
      error: "template_not_owned",
      message:
        "This template was not created from Resender, so it is read-only here. Edit or delete it in WhatsApp Manager.",
      reason: "template_not_owned",
      outcome: "dropped",
    }
  }

  return { ...resolved, template }
}

// El fallo de Graph, con su status y su código intactos: la ruta contesta el
// mismo status que dio Meta para que un 429 se distinga de un 400 sin leer
// texto. `reason` de la traducción del cliente es lo accionable; el crudo es el
// respaldo cuando el código no está en ningún catálogo.
function fromGraphFailure(
  failure: WhatsappTemplateApiFailure,
  error: string
): TemplateAdminFailure {
  return {
    ok: false,
    status: failure.status,
    error,
    message: failure.reason ?? failure.error,
    reason: "meta_rejected",
    outcome: "failed",
    metaErrorCode: failure.metaErrorCode,
  }
}

function toTemplateAdminView(
  template: WhatsappTemplateRecord,
  tenantId: string
): TemplateAdminView {
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    status: template.status,
    ...(template.status === "unknown" ? { rawStatus: template.rawStatus } : {}),
    category: template.category,
    metaTemplateId: template.metaTemplateId,
    own: template.createdByTenantId === tenantId,
    createdAt: template.createdAt.toISOString(),
    syncedAt: template.syncedAt.toISOString(),
  }
}

function invalid(error: string, message: string) {
  return { ok: false as const, error, message }
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// Reusa la normalización del espejo —que traduce `UTILITY` a `utility` y
// devuelve `null` para lo que no reconoce— y le agrega el único recorte propio
// del editor: `authentication` se reconoce en la base pero no se acepta acá.
function readEditableCategory(
  value: unknown
): WhatsappTemplateEditableCategory | null {
  const normalized = normalizeWhatsappTemplateCategory(
    typeof value === "string" ? value : null
  )
  return (
    WHATSAPP_TEMPLATE_EDITABLE_CATEGORIES.find(
      (category) => category === normalized
    ) ?? null
  )
}

// Acepta las dos formas: el array de arrays que pide Meta y el array simple que
// manda todo el mundo la primera vez. Devuelve siempre el primer juego de
// valores, que es el único que Meta usa para revisar.
function readBodyExamples(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  const bodyText = (value as { body_text?: unknown }).body_text
  if (!Array.isArray(bodyText) || bodyText.length === 0) return []

  const first = bodyText[0]
  const values = Array.isArray(first) ? first : bodyText
  return values.filter((entry): entry is string => typeof entry === "string")
}

// Las variables posicionales del cuerpo. Se cuentan las **distintas**, no las
// apariciones: `{{1}}` repetido dos veces sigue siendo una sola variable y un
// solo ejemplo, y contar apariciones pediría un ejemplo de más.
function countPositionalVariables(text: string): number {
  const found = new Set<string>()
  for (const match of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    found.add(match[1]!)
  }
  return found.size
}
