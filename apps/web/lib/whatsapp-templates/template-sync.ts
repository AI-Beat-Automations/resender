import { decryptSecret } from "@/lib/crypto/encryption"
import { getSql } from "@/lib/db"
import { isWhatsappExpiredTokenError } from "@/lib/meta/whatsapp-client"
import { listWhatsappTemplatesInGraph } from "@/lib/meta/whatsapp-template-client"
import { describeError, log } from "@/lib/observability/logger"
import { markPageTokenInvalid } from "@/lib/pages/page-registry"

import { upsertSyncedWhatsappTemplates } from "./template-registry"

// **La importación del catálogo de una WABA al espejo** (ADR 0014): el trabajo
// del job `template_sync`, que se encola al conectar un número.
//
// Es orquestación y nada más —leer la conexión, pedirle el catálogo a Graph y
// mandárselo al espejo—, y por eso vive acá y no en la cola: el `switch` de
// `lib/jobs/whatsapp-queue.ts` es un despachador y crece a base de `case`s de
// una línea. Las decisiones que tiene esta importación están en otros módulos y
// se reusan: la paginación en `listWhatsappTemplatesInGraph`, y la sentencia
// del upsert —con la forma canónica del idioma, los lotes y la regla del
// dueño— en `upsertSyncedWhatsappTemplates`. **Acá no se escribe SQL del
// espejo**: una segunda copia del `on conflict` se desincroniza del `coalesce`
// del registry en la primera edición, y ese `coalesce` es lo único que impide
// que un sync le saque el dueño a una plantilla propia.
//
// **Por qué se encola también en el flujo estándar**, donde el catálogo suele
// estar vacío y el job termina en una sola llamada a Graph: porque «suele» no
// es «siempre». Una WABA nueva puede traer plantillas si el cliente ya la había
// creado en Business Manager antes de pasar por el Embedded Signup, y sobre
// todo puede ser una WABA que **ya tiene otro número nuestro conectado** —la
// plantilla vive en la WABA y no en el número—, con lo cual el catálogo está
// lleno desde el primer segundo. Encolarlo sólo en Coexistence habría dejado
// esa asimetría escondida detrás de un flujo que casi siempre acierta, que es
// la forma más cara de equivocarse: el gate del envío falla abierto, así que un
// espejo que nunca se llenó se ve exactamente igual que una WABA sin
// plantillas. Un job de más contra una WABA vacía cuesta una request.
//
// **Sólo entra lo que el espejo guarda**: nombre, idioma, estado crudo,
// categoría y el hsm id. Los `components` no se piden ni se guardan —el cliente
// de Graph ni siquiera los trae en `fields`— porque Meta es dueño del contenido
// y el espejo no lo resincroniza nunca (ADR 0014).

type SyncConnectionRow = {
  tenant_id: string
  waba_id: string | null
  page_access_token_encrypted: string
  status: string
}

export type TemplateSyncOutcome =
  | {
      ok: true
      /** Cuántas filas del catálogo se espejaron. */
      imported: number
      /** `true` si lo espejado **no es** el catálogo entero. */
      truncated: boolean
    }
  | {
      ok: false
      reason:
        | "connection_not_found"
        | "connection_not_active"
        | "missing_waba_id"
        | "graph_failed"
    }

/**
 * Espeja el catálogo de plantillas de la WABA de una conexión.
 *
 * **Idempotente por construcción y no por estado.** A diferencia de
 * `requestHistorySync` —que se guarda de repetirse porque un segundo pedido
 * arranca otra vez el reloj de 24 h de Meta—, acá repetir no cuesta nada: el
 * upsert va por `(waba_id, name, language)` y vuelve a escribir lo mismo. Eso
 * es lo que hace que dos números de la misma WABA conectándose el mismo día no
 * dupliquen ni una fila, y lo que permite que el reintento de la cola replique
 * la importación entera sin comparar nada antes.
 *
 * **No lanza cuando el que falla es Graph.** El resto del job sí: un error de
 * la base sube y la cola reintenta, porque escribir el espejo es lo único que
 * este trabajo hace y un reintento lo repara. Un fallo de Graph, en cambio,
 * deja el catálogo sin importar y eso **no es una emergencia**: el gate del
 * envío falla abierto, así que un espejo hueco no bloquea ningún envío
 * legítimo; el precio es que las plantillas no se listan hasta el próximo sync.
 * Se registra con `template_sync_failed` justamente porque no se queja solo.
 */
export async function syncWhatsappTemplateCatalog(input: {
  connectionId: string
}): Promise<TemplateSyncOutcome> {
  const sql = getSql()

  const [row] = await sql<SyncConnectionRow[]>`
    select tenant_id, waba_id, page_access_token_encrypted, status
    from connected_pages
    where id = ${input.connectionId}
      and channel = 'whatsapp'
    limit 1
  `

  // La conexión se borró entre el callback y el job, o el tenant la
  // desconectó. No hay catálogo que importar y no hay nada que reparar: es el
  // descarte benigno de siempre, en `info`.
  if (!row) {
    log({
      entrypoint: "queue",
      action: "template_sync",
      outcome: "skipped",
      reason: "page_not_connected",
      channel: "whatsapp",
      connectionId: input.connectionId,
    })
    return { ok: false, reason: "connection_not_found" }
  }

  if (row.status !== "active") {
    log({
      entrypoint: "queue",
      action: "template_sync",
      outcome: "skipped",
      reason: "page_not_connected",
      channel: "whatsapp",
      tenantId: row.tenant_id,
      connectionId: input.connectionId,
    })
    return { ok: false, reason: "connection_not_active" }
  }

  // Una conexión de WhatsApp sin WABA no debería existir —el onboarding
  // persiste la que confirmó Graph— así que esto no es un descarte benigno
  // sino un invariante roto, y va en `failed` para que se vea. Sin WABA no hay
  // catálogo: la plantilla vive ahí y no en el número.
  if (!row.waba_id) {
    log({
      entrypoint: "queue",
      action: "template_sync",
      outcome: "failed",
      reason: "missing_waba_id",
      channel: "whatsapp",
      tenantId: row.tenant_id,
      connectionId: input.connectionId,
    })
    return { ok: false, reason: "missing_waba_id" }
  }

  const wabaId = row.waba_id

  // El cliente pagina solo y devuelve todo lo que llegó a leer. Los topes de
  // página quedan en sus valores por defecto —son un freno contra un cursor que
  // no avanza, no un límite de Meta que estemos modelando— y **es el único
  // llamador que hay**: no se pasan `pageSize` ni `maxPages`, así que los
  // defaults del cliente son los que corren en producción y tienen que cubrir
  // la WABA llena por sí solos.
  const catalogue = await listWhatsappTemplatesInGraph({
    accessToken: decryptSecret(row.page_access_token_encrypted),
    wabaId,
  })

  if (!catalogue.ok) {
    log({
      entrypoint: "queue",
      action: "template_sync",
      outcome: "failed",
      reason: "template_sync_failed",
      channel: "whatsapp",
      tenantId: row.tenant_id,
      connectionId: input.connectionId,
      wabaId,
      status: catalogue.status,
      ...(catalogue.metaErrorCode !== null
        ? { errorCode: catalogue.metaErrorCode }
        : {}),
      errorMessage: catalogue.error,
    })

    // **El token vencido se marca, igual que en todos los demás llamadores de
    // Graph de este canal** (`app/api/meta/whatsapp/send/route.ts`). Sin esto
    // el job es el único camino que ve el 190 y se lo queda: la tarjeta de
    // conexión sigue verde, el catálogo se queda vacío para siempre y el
    // cliente no tiene de dónde deducir que hay que reconectar el número.
    //
    // `metaErrorCode` es lo único que el cliente del catálogo conserva del
    // error crudo, así que se lo devuelve a la forma que el detector sabe leer:
    // repetir acá el `=== 190` sería una segunda copia de esa regla.
    if (
      isWhatsappExpiredTokenError({ error: { code: catalogue.metaErrorCode } })
    ) {
      try {
        await markPageTokenInvalid({
          tenantId: row.tenant_id,
          connectionId: input.connectionId,
          error:
            catalogue.error ||
            "Meta rejected the WhatsApp token. Reconnect the number in Resender.",
        })
      } catch (error) {
        // Best-effort, como en la ruta de envío: que no se pueda marcar el
        // token no puede convertir un fallo de Graph —que no se reintenta— en
        // una excepción que sí manda el job a la DLQ.
        log({
          entrypoint: "queue",
          action: "token_invalidate",
          outcome: "failed",
          reason: "internal_error",
          channel: "whatsapp",
          tenantId: row.tenant_id,
          connectionId: input.connectionId,
          wabaId,
          errorMessage: describeError(error),
        })
      }
    }

    return { ok: false, reason: "graph_failed" }
  }

  // **Sólo lo que el espejo guarda**, y esta traducción es todo lo que este
  // módulo aporta a la escritura: el lote, la clave canónica y la regla del
  // dueño son del registry. Los `components` no aparecen porque el cliente de
  // Graph ni siquiera los pide (ADR 0014).
  //
  // Si un lote falla, el error sube: los lotes anteriores quedan escritos —el
  // espejo parcial es válido— y el reintento de la cola vuelve a pasar por todo
  // sin duplicar nada. El lote que falló no deja medias filas, porque
  // `sql.transaction` es atómico.
  await upsertSyncedWhatsappTemplates(
    catalogue.templates.map((template) => ({
      wabaId,
      name: template.name,
      language: template.language,
      // Crudo: la columna no tiene check y un estado que Meta agregó ayer tiene
      // que llegar a la base para que se lo pueda ver.
      status: template.status,
      category: template.category,
      metaTemplateId: template.id,
    }))
  )

  // **El catálogo incompleto se dice.** `truncated` significa que Graph dejó de
  // avanzar, que se agotó el tope de páginas o que Graph falló a mitad de la
  // paginación —en ese último caso lo leído se espeja igual—, y lo espejado es
  // una parte del catálogo real. Terminar esto con un `ok` sería exactamente lo que el espejo
  // no puede hacer: el gate del envío falla abierto, así que una plantilla que
  // faltó no produce ningún error visible —se envía y decide Meta— y la lista
  // del cliente miente sin que nadie se entere.
  const terminal = {
    entrypoint: "queue",
    action: "template_sync",
    channel: "whatsapp",
    tenantId: row.tenant_id,
    connectionId: input.connectionId,
    wabaId,
    count: catalogue.templates.length,
    // Las filas que Graph devolvió y no se pudieron leer. Va siempre, incluso
    // en cero: es lo que permite contrastar `count` con lo que Meta dice tener
    // sin abrir la respuesta cruda. Un `droppedCount` alto con `outcome: "ok"`
    // es la firma de que la forma de la respuesta cambió, y sin este número se
    // vería igual que una WABA con menos plantillas.
    droppedCount: catalogue.dropped,
  } as const

  if (catalogue.truncated) {
    log({ ...terminal, outcome: "failed", reason: "template_sync_failed" })
  } else {
    log({ ...terminal, outcome: "ok" })
  }

  return {
    ok: true,
    imported: catalogue.templates.length,
    truncated: catalogue.truncated,
  }
}
