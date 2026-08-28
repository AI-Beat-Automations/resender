import { getSql, type Sql } from "@/lib/db"

// El espejo local del catálogo de plantillas de una WABA (migración 0018).
//
// **Meta es dueño de la plantilla; esto es una copia que no manda** (ADR 0014).
// Se guarda lo mínimo —`(waba_id, name, language, status)` y el hsm id— y sirve
// para dos cosas: listar el catálogo de un número y saber si una plantilla está
// aprobada. Nunca para decidir qué se envía: eso lo decide `template-gate.ts`,
// que es puro y falla abierto justamente porque este espejo puede estar
// incompleto.
//
// La fila es **de la WABA y no del tenant**, porque la plantilla vive en la WABA
// y dos números de tenants distintos pueden compartirla. `created_by_tenant_id`
// no es ownership de la fila: es la marca de quién la creó desde Resender, que
// es lo único que habilita editarla y borrarla. `null` —vino del sync, o la creó
// una cuenta que ya no existe— significa read-only para todos.
//
// La clave es `(waba_id, name, language)` y el `language` **se normaliza acá
// adentro**, en todas las lecturas por clave y en todas las escrituras: Meta
// escribe el mismo idioma de dos formas según por dónde entre (`en-US` por el
// webhook, `en_US` por Graph) y dos formas de la clave son dos filas para la
// misma plantilla. Ver `normalizeWhatsappTemplateLanguage`, al final.

// Las tres categorías del check de la 0018. El editor v1 sólo ofrece las dos
// primeras: `authentication` tiene forma restringida y reglas de OTP propias, y
// está fuera de alcance (ADR 0014), pero el sync sí puede traer plantillas de
// esa categoría creadas en WhatsApp Manager y hay que poder espejarlas.
export const WHATSAPP_TEMPLATE_CATEGORIES = [
  "utility",
  "marketing",
  "authentication",
] as const

export type WhatsappTemplateCategory =
  (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number]

// Los estados que sabemos nombrar. **La columna no tiene check** (0018 §3) y
// esta lista no es un contrato con la base: es lo que este módulo reconoce, y
// todo lo demás se normaliza a `unknown` al leer.
//
// La lista sale de cruzar tres fuentes, porque ninguna sola la tiene entera y
// el catálogo de Meta no es estable:
//   - la doc de plantillas de Meta (`APPROVED`, `REJECTED`, `PAUSED`,
//     `DISABLED`, y «In-Review» como estado de WhatsApp Manager);
//   - la referencia de estados de AWS End User Messaging Social, que documenta
//     además el apelado y el pausado por calidad;
//   - las tablas de estados de los BSP (Twilio, 360dialog, Bird), que coinciden
//     en `PENDING`, `PENDING_DELETION`, `IN_APPEAL` y `LIMIT_EXCEEDED`.
// `PENDING` e `IN_REVIEW` conviven a propósito: son el mismo hecho con dos
// nombres según qué página de Meta se lea, y adivinar cuál «gana» sería
// inventar. Ninguno de los dos permite enviar, así que la ambigüedad no llega a
// la decisión.
export const WHATSAPP_TEMPLATE_STATUSES = [
  "APPROVED",
  "PENDING",
  "IN_REVIEW",
  "IN_APPEAL",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "PENDING_DELETION",
  "LIMIT_EXCEEDED",
] as const

export type WhatsappTemplateKnownStatus =
  (typeof WHATSAPP_TEMPLATE_STATUSES)[number]

// **Cuántas plantillas entran en una escritura** cuando se espeja un catálogo
// entero (`upsertSyncedWhatsappTemplates`). No es una preferencia de estilo: en
// el driver HTTP de Neon cada `sql` es un `fetch`, o sea una subrequest de
// Workers, y el presupuesto es de 1.000 por invocación —compartidas entre los
// hasta 10 jobs que la cola entrega en un batch (`wrangler.jsonc`)—. Una WABA
// llena son 6.000 plantillas: fila por fila el job reventaría con «Too many
// subrequests» a mitad del bucle, cada reintento moriría en el mismo punto y el
// mensaje terminaría en la DLQ, donde `template_sync` no hace nada a propósito;
// el espejo quedaría clavado en las primeras mil filas. Agrupadas de a 100 en
// un `sql.transaction`, esas 6.000 filas son 60 subrequests.
//
// El tamaño es un compromiso entre subrequests y peso del cuerpo de cada una,
// no un límite de nada: 100 deja el peor caso conocido muy por debajo del techo
// aun con el batch entero de la cola corriendo syncs grandes a la vez.
const UPSERT_BATCH_SIZE = 100

// Mismo patrón que `attachment_type` (`lib/inbound/whatsapp-parsers/content.ts`):
// el catálogo cerrado **más** `unknown`, porque Meta agrega estados sin cambiar
// de versión de API. Lo que no reconocemos no se envía.
export type WhatsappTemplateStatus = WhatsappTemplateKnownStatus | "unknown"

// Sólo para tests: permite ejercitar el SQL real de este módulo (en
// particular el `coalesce` del `on conflict` de `upsertWhatsappTemplateQuery`,
// por los dos caminos que lo comparten: la fila suelta y el lote) contra PGlite
// en vez de contra un mock de `sql`, que no puede demostrar lo que hace un
// `coalesce` de Postgres. Sin llamar a esto el módulo se comporta exactamente
// como antes: `resolveSql()` cae a `getSql()`.
let sqlOverrideForTests: Sql | undefined

export function __setSqlForTests(sql: Sql | undefined): void {
  sqlOverrideForTests = sql
}

function resolveSql(): Sql {
  return sqlOverrideForTests ?? getSql()
}

export type WhatsappTemplateRecord = {
  id: string
  wabaId: string
  name: string
  language: string
  // El hsm id. Es lo único con lo que se borra una sola versión de idioma; sin
  // él el `DELETE` se rechaza en vez de caer al borrado por nombre, que se
  // llevaría todos los idiomas y quemaría el nombre 30 días.
  metaTemplateId: string | null
  category: WhatsappTemplateCategory | null
  // Normalizado. `unknown` es «Meta dijo algo que no sabemos leer».
  status: WhatsappTemplateStatus
  // El string literal que mandó Meta, igual que `details.rawType` en los
  // adjuntos: normalizar no puede costar el dato. Es lo que le permite al
  // cliente ver un estado nuevo antes de que nosotros lo modelemos, y lo que
  // hace medible qué está llegando.
  rawStatus: string
  createdByTenantId: string | null
  syncedAt: Date
  createdAt: Date
}

type WhatsappTemplateRow = {
  id: string
  waba_id: string
  name: string
  language: string
  meta_template_id: string | null
  category: WhatsappTemplateCategory | null
  status: string
  created_by_tenant_id: string | null
  synced_at: Date
  created_at: Date
}

/**
 * La fila del espejo de una plantilla concreta, o `null` si no la conocemos.
 *
 * Es lo que consume el gate del envío, y por eso devuelve `null` en vez de
 * lanzar: «no está en el espejo» es una respuesta legítima y no un error.
 */
export async function getWhatsappTemplate(input: {
  wabaId: string
  name: string
  language: string
}): Promise<WhatsappTemplateRecord | null> {
  const sql = resolveSql()
  const [row] = await sql<WhatsappTemplateRow[]>`
    select id, waba_id, name, language, meta_template_id, category, status,
      created_by_tenant_id, synced_at, created_at
    from whatsapp_templates
    where waba_id = ${input.wabaId}
      and name = ${input.name}
      and language = ${normalizeWhatsappTemplateLanguage(input.language)}
    limit 1
  `

  return row ? mapWhatsappTemplate(row) : null
}

/**
 * El catálogo entero de una WABA, de cualquier tenant.
 *
 * Cruza tenants a propósito, por el mismo motivo que
 * `countActiveWhatsappNumbersInWaba`: el catálogo es del recurso compartido y
 * esconder las plantillas ajenas produciría una lista que miente sobre lo que
 * ese número puede enviar. Quién puede editarlas es otra pregunta, y la
 * contesta `createdByTenantId`.
 *
 * Orden estable y no por fecha: el nombre y el idioma son la identidad de la
 * plantilla, así que ordenar por ellos deja la lista igual entre dos lecturas
 * aunque el sync haya vuelto a tocar `synced_at` en el medio.
 */
export async function listWhatsappTemplates(input: {
  wabaId: string
}): Promise<WhatsappTemplateRecord[]> {
  const sql = resolveSql()
  const rows = await sql<WhatsappTemplateRow[]>`
    select id, waba_id, name, language, meta_template_id, category, status,
      created_by_tenant_id, synced_at, created_at
    from whatsapp_templates
    where waba_id = ${input.wabaId}
    order by name asc, language asc
  `

  return rows.map(mapWhatsappTemplate)
}

/**
 * La fila por su id nuestro, para `PATCH` y `DELETE`.
 *
 * Sin filtro por tenant: la comprobación de propiedad la hace la ruta contra
 * `createdByTenantId`, y necesita distinguir «no existe» (404) de «existe pero
 * es ajena» (403 explicando que se edita en WhatsApp Manager). Filtrando acá
 * las dos se verían igual.
 */
export async function getWhatsappTemplateById(
  id: string
): Promise<WhatsappTemplateRecord | null> {
  const sql = resolveSql()
  const [row] = await sql<WhatsappTemplateRow[]>`
    select id, waba_id, name, language, meta_template_id, category, status,
      created_by_tenant_id, synced_at, created_at
    from whatsapp_templates
    where id = ${id}
    limit 1
  `

  return row ? mapWhatsappTemplate(row) : null
}

export type WhatsappTemplateUpsertInput = {
  wabaId: string
  name: string
  language: string
  // Crudo, tal cual lo dijo Meta: la columna no tiene check y normalizar de ida
  // convertiría un estado nuevo en `unknown` para siempre. Se normaliza al
  // leer, no al escribir.
  status: string
  category?: WhatsappTemplateCategory | null
  metaTemplateId?: string | null
}

/**
 * Espeja una plantilla que vino del sync del catálogo.
 *
 * El sync no aporta dueño —lo que Meta devuelve no dice quién la creó— y por
 * eso pasa `null`: una plantilla que ya conocíamos como propia no puede
 * volverse ajena porque el job la vuelva a ver.
 */
export async function upsertSyncedWhatsappTemplate(
  input: WhatsappTemplateUpsertInput
): Promise<WhatsappTemplateRecord> {
  return upsertWhatsappTemplateRow({ ...input, createdByTenantId: null })
}

/**
 * Espeja **un catálogo entero** que vino del sync, en lotes atómicos.
 *
 * Existe para que el job de sync no tenga que armar su propia copia del upsert:
 * un lote necesita la consulta **sin ejecutar** —eso es lo que come
 * `sql.transaction`— y `upsertSyncedWhatsappTemplate` devuelve la escritura ya
 * hecha. Las dos formas comparten `upsertWhatsappTemplateQuery`, así que la
 * regla del dueño vive en una sola sentencia y no puede desincronizarse entre
 * el camino de una fila y el de lote.
 *
 * Misma promesa que la versión de una fila: `createdByTenantId` va en `null`,
 * y el `coalesce` de la sentencia hace que una plantilla que ya conocíamos como
 * propia **no** pueda volverse ajena porque el job la vuelva a ver.
 *
 * No devuelve las filas: el llamador es un job que no las mira, y mapear 6.000
 * registros para descartarlos sería trabajo puro. Si un lote falla el error
 * sube —los lotes anteriores quedan escritos, el espejo parcial es válido— y el
 * reintento de la cola vuelve a pasar por todo sin duplicar nada: el upsert va
 * por `(waba_id, name, language)`.
 */
export async function upsertSyncedWhatsappTemplates(
  inputs: WhatsappTemplateUpsertInput[]
): Promise<void> {
  const sql = resolveSql()

  // En lotes y en serie. Un `Promise.all` sobre 6.000 plantillas abriría 6.000
  // requests HTTP simultáneas contra Neon desde un Worker, que es la forma de
  // convertir un catálogo grande en un incidente; los lotes atacan el problema
  // contrario —la **cantidad** de requests, no su concurrencia— y son los que
  // hacen que la WABA llena se pueda espejar (ver `UPSERT_BATCH_SIZE`). El
  // orden no importa: cada upsert toca una clave distinta.
  for (let start = 0; start < inputs.length; start += UPSERT_BATCH_SIZE) {
    const batch = inputs.slice(start, start + UPSERT_BATCH_SIZE)
    await sql.transaction(
      batch.map((input) =>
        upsertWhatsappTemplateQuery(sql, {
          ...input,
          createdByTenantId: null,
        })
      )
    )
  }
}

/**
 * Espeja una plantilla recién creada desde Resender, con su dueño.
 *
 * Es un upsert y no un insert porque el sync puede haberla visto primero: entre
 * el `POST` a Graph y el espejo cabe un job de sync, y ahí un insert fallaría
 * con el unique y le devolvería un error al cliente por una plantilla que sí se
 * creó bien en Meta.
 */
export async function createWhatsappTemplateMirror(
  input: WhatsappTemplateUpsertInput & { createdByTenantId: string }
): Promise<WhatsappTemplateRecord> {
  return upsertWhatsappTemplateRow(input)
}

async function upsertWhatsappTemplateRow(
  input: WhatsappTemplateUpsertInput & { createdByTenantId: string | null }
): Promise<WhatsappTemplateRecord> {
  const [row] = await upsertWhatsappTemplateQuery(resolveSql(), input)

  if (!row) throw new Error("upsert did not return a row")
  return mapWhatsappTemplate(row)
}

// **La única sentencia de upsert del espejo**, y por eso está aislada del
// `await`: devolverla sin ejecutar es lo que le permite al camino de lote
// (`upsertSyncedWhatsappTemplates`) pasársela a `sql.transaction` —el driver
// HTTP de Neon deja las queries perezosas justamente para eso (`lib/db.ts`)—
// mientras el camino de una fila la espera y mapea la fila que vuelve. Una
// segunda copia para el lote se desincronizaría del `coalesce` de abajo en la
// primera edición, y ese `coalesce` es la regla más cara de esta entrega.
//
// Un solo `on conflict` para los dos casos, y la regla que los separa está
// entera en el `coalesce`: **el dueño existente siempre gana**. Con `null`
// —el sync— la columna queda como estaba; con un tenant —la creación— sólo
// rellena si no había dueño. Escrito al revés (`excluded` ganando) el segundo
// sync de una WABA le sacaría el dueño a todo lo que el cliente creó desde acá
// y lo dejaría sin poder editar ni borrar sus propias plantillas.
//
// El `returning` viaja también en el lote, donde nadie lo lee. Es el precio de
// tener una sola sentencia, y es barato: son las mismas columnas que ya se
// escribieron, no contenido de plantilla —el espejo no guarda ninguno—.
function upsertWhatsappTemplateQuery(
  sql: Sql,
  input: WhatsappTemplateUpsertInput & { createdByTenantId: string | null }
): Promise<WhatsappTemplateRow[]> {
  return sql<WhatsappTemplateRow[]>`
    insert into whatsapp_templates (
      waba_id, name, language, meta_template_id, category, status,
      created_by_tenant_id
    )
    values (
      ${input.wabaId}, ${input.name},
      ${normalizeWhatsappTemplateLanguage(input.language)},
      ${input.metaTemplateId ?? null}, ${input.category ?? null},
      ${input.status}, ${input.createdByTenantId ?? null}::uuid
    )
    on conflict (waba_id, name, language) do update
      set status = excluded.status,
          -- coalesce y no asignación directa: la lista de plantillas de Graph
          -- puede venir sin categoría o sin id en una página, y perder el hsm id
          -- deja la fila imposible de borrar por el único camino que borra un
          -- solo idioma.
          category = coalesce(excluded.category, whatsapp_templates.category),
          meta_template_id = coalesce(
            excluded.meta_template_id, whatsapp_templates.meta_template_id
          ),
          -- El dueño existente primero, y por eso el sync tampoco puede robar
          -- nada: entra con excluded.created_by_tenant_id en null, así que el
          -- coalesce devuelve lo que ya había —incluido el null de una fila que
          -- nunca tuvo dueño—. Es la misma garantía que daba el sync cuando no
          -- nombraba la columna, escrita una sola vez para los dos caminos.
          created_by_tenant_id = coalesce(
            whatsapp_templates.created_by_tenant_id,
            excluded.created_by_tenant_id
          ),
          synced_at = now()
    returning id, waba_id, name, language, meta_template_id, category, status,
      created_by_tenant_id, synced_at, created_at
  `
}

/**
 * Mueve el estado (y la categoría, cuando cambia) de una plantilla del espejo.
 *
 * Lo escribe el webhook de Meta, que es la única fuente que mantiene fresco el
 * `status`. **No inserta si la fila no está**: el webhook trae el estado, no la
 * plantilla —ni el hsm id ni la categoría completa—, así que fabricar una fila
 * con lo que no sabemos dejaría el espejo peor que el hueco, y el hueco ya
 * tiene un significado definido (se envía igual y decide Meta).
 *
 * `null` es «no había fila», y el llamador lo trata como un no-evento.
 */
export async function updateWhatsappTemplateStatus(input: {
  wabaId: string
  name: string
  language: string
  status: string
  category?: WhatsappTemplateCategory | null
  // El `hsm_id` que trae el webhook (issue #79, hallazgo N2). Rellena el hueco
  // pero **no pisa** lo que ya hay: el `coalesce` lleva la columna primero y el
  // valor del webhook segundo —al revés que en `upsertWhatsappTemplateRow` para
  // el sync completo, y a propósito—. El hsm id de Meta es estable, así que si
  // el nuestro difiere del que llega acá, el que tenemos vino de un `GET` a
  // Graph directo y merece más confianza que un campo suelto de un evento de
  // webhook. Sin este relleno, una fila que quedó sin `meta_template_id` no lo
  // recupera nunca por este camino y queda ineditable e imborrable (409
  // `template_missing_meta_id`) hasta el próximo sync completo.
  metaTemplateId?: string | null
}): Promise<WhatsappTemplateRecord | null> {
  const sql = resolveSql()
  const [row] = await sql<WhatsappTemplateRow[]>`
    update whatsapp_templates
    set status = ${input.status},
        category = coalesce(${input.category ?? null}, category),
        meta_template_id = coalesce(
          meta_template_id, ${input.metaTemplateId ?? null}
        ),
        synced_at = now()
    where waba_id = ${input.wabaId}
      and name = ${input.name}
      and language = ${normalizeWhatsappTemplateLanguage(input.language)}
    returning id, waba_id, name, language, meta_template_id, category, status,
      created_by_tenant_id, synced_at, created_at
  `

  return row ? mapWhatsappTemplate(row) : null
}

/**
 * Mueve **sólo** la categoría de una plantilla del espejo.
 *
 * Existe aparte de `updateWhatsappTemplateStatus` porque el webhook
 * `template_category_update` no trae estado: Meta recategoriza una plantilla ya
 * aprobada sin volver a revisarla, así que escribir un estado aquí obligaría a
 * inventarlo o a leerlo antes para volver a escribir el mismo valor, y las dos
 * cosas pueden dejar el espejo diciendo algo que Meta no dijo.
 *
 * Comparte con su hermana todo lo demás: la clave normalizada, el no insertar
 * si la fila no está, y el `null` que el llamador trata como un no-evento.
 */
export async function updateWhatsappTemplateCategory(input: {
  wabaId: string
  name: string
  language: string
  category: WhatsappTemplateCategory
  // Mismo relleno y mismo criterio que en `updateWhatsappTemplateStatus`: este
  // evento también trae el hsm id (viene de `readIdentity`, compartida por los
  // dos), y rellenar el hueco sin pisar lo que ya hay evita el mismo callejón
  // sin salida —409 `template_missing_meta_id`— cuando el hueco se cerró por
  // acá y no por un cambio de estado.
  metaTemplateId?: string | null
}): Promise<WhatsappTemplateRecord | null> {
  const sql = resolveSql()
  const [row] = await sql<WhatsappTemplateRow[]>`
    update whatsapp_templates
    set category = ${input.category},
        meta_template_id = coalesce(
          meta_template_id, ${input.metaTemplateId ?? null}
        ),
        synced_at = now()
    where waba_id = ${input.wabaId}
      and name = ${input.name}
      and language = ${normalizeWhatsappTemplateLanguage(input.language)}
    returning id, waba_id, name, language, meta_template_id, category, status,
      created_by_tenant_id, synced_at, created_at
  `

  return row ? mapWhatsappTemplate(row) : null
}

/**
 * Borra la fila del espejo por id.
 *
 * Sólo el espejo: la plantilla en Meta la borra la ruta antes, por `hsm_id`.
 * Si esta fila sobreviviera a un borrado exitoso en Graph el catálogo mostraría
 * una plantilla que ya no existe; si se borrara antes y Graph fallara,
 * quedaríamos sin el hsm id que hace falta para reintentar. Devuelve `false`
 * cuando no había fila, que es lo que hace idempotente al reintento.
 */
export async function deleteWhatsappTemplate(id: string): Promise<boolean> {
  const sql = resolveSql()
  const rows = await sql`
    delete from whatsapp_templates
    where id = ${id}
    returning id
  `

  return rows.length > 0
}

// Normaliza el estado crudo de Meta al catálogo cerrado. `unknown` para todo lo
// demás, incluida la cadena vacía: no reconocerlo no es lo mismo que estar
// aprobado, y el gate rechaza los dos igual.
//
// Se compara en mayúsculas y sin espacios porque el estado llega por dos
// caminos distintos —el listado de Graph y el webhook— y no vale la pena que un
// `approved` en minúscula cueste un envío legítimo. El valor literal se
// conserva en `rawStatus`, así que normalizar no pierde nada.
export function normalizeWhatsappTemplateStatus(
  raw: string
): WhatsappTemplateStatus {
  const candidate = raw.trim().toUpperCase()
  return (
    WHATSAPP_TEMPLATE_STATUSES.find((status) => status === candidate) ??
    "unknown"
  )
}

// La forma canónica del idioma en el espejo es la de **guion bajo** (`en_US`),
// que es la que usan el catálogo de Graph y el `template.language.code` del
// envío.
//
// No es cosmética: es lo único que impide que el sync y el webhook escriban en
// dos filas distintas para la misma plantilla. Los webhooks de plantilla traen
// el idioma con guion (`en-US`, y también `en` a secas) y el listado de Graph
// lo devuelve con guion bajo; como la clave del espejo es
// `(waba_id, name, language)`, sin esta función el `update` del webhook no
// encontraría **nunca** la fila que insertó el sync. El fallo no se ve: no hay
// error, no hay fila nueva, y el gate del envío sigue decidiendo contra un
// estado viejo hasta que alguien lo note a mano.
//
// Por eso vive acá y no en el parser —que es puro y reporta lo que Meta mandó,
// sin conocer la otra punta— ni en cada llamador, que es donde se olvida: la
// aplican todas las escrituras y todas las lecturas por clave de este módulo,
// así que ningún llamador puede saltearla.
//
// Se canoniza también el uso de mayúsculas de la región (`en_us` → `en_US`)
// porque el catálogo de idiomas de Meta es fijo y siempre tiene esa forma, y
// porque este valor no se queda en casa: sale por el `GET` del CRUD y vuelve
// tal cual en el `language` del envío. Guardar una variante que Meta no acepta
// sería peor que no normalizar. Lo que no tiene forma de código de idioma se
// deja como llegó, con el guion ya sustituido: inventar sobre un valor que no
// entendemos es la otra manera de perder la fila.
export function normalizeWhatsappTemplateLanguage(raw: string): string {
  const candidate = raw.trim().replace(/-/g, "_")
  const parts = /^([a-z]{2,3})_([a-z]{2,4})$/i.exec(candidate)
  if (!parts) return candidate

  return `${parts[1]!.toLowerCase()}_${parts[2]!.toUpperCase()}`
}

// Meta nombra la categoría en mayúsculas (`UTILITY`) y el check de la 0018 la
// guarda en minúsculas, así que sin esta traducción el `update` del webhook
// rompería contra la restricción y se llevaría por delante el lote entero.
//
// `null` es «no la reconocemos», y se junta a propósito con «no vino ninguna»:
// las dos se resuelven igual río abajo —se deja la categoría que ya estaba— y
// distinguirlas obligaría a cada llamador a decidir sobre un valor que, por
// definición, no sabe leer. Al revés que con `status`, acá no se puede
// conservar el valor crudo: la columna sí tiene check.
export function normalizeWhatsappTemplateCategory(
  raw: string | null | undefined
): WhatsappTemplateCategory | null {
  if (!raw) return null

  const candidate = raw.trim().toLowerCase()
  return (
    WHATSAPP_TEMPLATE_CATEGORIES.find((category) => category === candidate) ??
    null
  )
}

function mapWhatsappTemplate(row: WhatsappTemplateRow): WhatsappTemplateRecord {
  return {
    id: row.id,
    wabaId: row.waba_id,
    name: row.name,
    language: row.language,
    metaTemplateId: row.meta_template_id,
    category: row.category,
    status: normalizeWhatsappTemplateStatus(row.status),
    rawStatus: row.status,
    createdByTenantId: row.created_by_tenant_id,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
  }
}
