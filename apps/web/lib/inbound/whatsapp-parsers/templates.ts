import {
  asNumber,
  asRecord,
  asString,
  asTextId,
  normalizeTimestamp,
} from "./coerce"
import type { WhatsappAccountChange } from "./envelope"
import type { WhatsappTemplateEvent, WhatsappTemplateRejection } from "./types"

// Los tres campos con los que Meta avisa de que algo cambió en una plantilla de
// la WABA: `message_template_status_update` (aprobada, rechazada, pausada…),
// `template_category_update` (cambió o va a cambiar de categoría) y
// `message_template_quality_update` (subió o bajó su calidad).
//
// **Un solo módulo para los tres**, y no tres archivos, porque lo que comparten
// no es un parecido de forma sino la clave: los tres identifican la plantilla
// con el mismo trío `(waba_id, name, language)` más el id de Meta, y separarlos
// habría triplicado `readIdentity` —la única parte donde equivocarse deja el
// espejo apuntando a la fila que no era—.
//
// Son de **ámbito WABA**: su `value` no trae `metadata` ni, por tanto,
// `phone_number_id`, porque la plantilla vive en la cuenta y no en el número
// (ADR 0014). Por eso piden un `WhatsappAccountChange` y no el
// `WhatsappChange` de la mensajería, y por eso `entry.id` deja de ser
// decorativo aquí: es la única fuente del WABA en todo el payload.
//
// Código puro, como el resto del directorio: sin I/O, sin base de datos y sin
// llamadas a Meta. El webhook se contesta con 200 antes de tocar nada, y en
// particular **no se refetchea el contenido de la plantilla**: de estos eventos
// solo tiene que quedar fresco el estado.

export function readTemplateStatusUpdate(
  change: WhatsappAccountChange
): WhatsappTemplateEvent | null {
  const identity = readIdentity(change)
  if (!identity) return null

  // Lo único que se exige del `event` es que exista. Su valor no se coteja
  // contra ningún catálogo y no se descarta nada: ver el comentario de `status`
  // en `types.ts`, que es donde vive el argumento.
  const status = asString(change.value.event)
  if (!status) return null

  return {
    ...identity,
    kind: "status",
    status,
    reason: asString(change.value.reason),
    category: asString(change.value.message_template_category),
    rejection: readRejection(change.value.rejection_info),
  }
}

export function readTemplateCategoryUpdate(
  change: WhatsappAccountChange
): WhatsappTemplateEvent | null {
  const identity = readIdentity(change)
  if (!identity) return null

  // `new_category` es la categoría **vigente** en las dos variantes del
  // webhook, así que es la que se emite como `category` sin mirar cuál llegó.
  // La lectura ingenua —«el aviso inminente trae la categoría futura»— es al
  // revés y adelantaría en el espejo un cambio que aún no ocurrió.
  const category = asString(change.value.new_category)
  if (!category) return null

  const pendingCategory = asString(change.value.correct_category)
  const pendingTimestamp = asNumber(change.value.category_update_timestamp)

  return {
    ...identity,
    kind: "category",
    category,
    previousCategory: asString(change.value.previous_category),
    pendingCategory,
    // `normalizeTimestamp` inventa `new Date()` cuando no puede leer nada, que
    // aquí sería un plazo falso: la variante consumada no trae fecha porque no
    // hay nada pendiente, y decir «ya» sería peor que decir «no consta».
    pendingAt:
      pendingTimestamp === null ? null : normalizeTimestamp(pendingTimestamp),
  }
}

export function readTemplateQualityUpdate(
  change: WhatsappAccountChange
): WhatsappTemplateEvent | null {
  const identity = readIdentity(change)
  if (!identity) return null

  const qualityScore = asString(change.value.new_quality_score)
  if (!qualityScore) return null

  return {
    ...identity,
    kind: "quality",
    qualityScore,
    previousQualityScore: asString(change.value.previous_quality_score),
  }
}

type TemplateIdentity = Pick<
  WhatsappTemplateEvent,
  "wabaId" | "metaTemplateId" | "name" | "language"
>

// El trío que identifica la plantilla, más el id de Meta. Devuelve null —y con
// ello descarta el evento entero— cuando falta cualquiera de las tres partes de
// la clave: sin ellas no hay fila del espejo que actualizar, así que emitir el
// evento solo trasladaría el problema al consumidor, que tendría que volver a
// descubrir que no puede hacer nada con él.
//
// Es el mismo criterio con el que `statuses.ts` descarta un acuse sin `id`, y
// no tiene nada que ver con la tolerancia hacia los valores desconocidos: una
// cosa es no saber a **qué fila** apunta el evento y otra no reconocer el
// **valor** que trae.
function readIdentity(change: WhatsappAccountChange): TemplateIdentity | null {
  const name = asString(change.value.message_template_name)
  const language = asString(change.value.message_template_language)
  if (!change.wabaId || !name || !language) return null

  return {
    wabaId: change.wabaId,
    // `message_template_id` llega como **número** JSON en todos los ejemplos de
    // Meta, mientras que la columna `meta_template_id` es `text` (0018): es lo
    // único con lo que se borra una sola versión de idioma. `asTextId` es el
    // mismo helper con el que el sobre lee `entry.id`, que sufre exactamente la
    // misma contradicción entre la documentación y el payload.
    metaTemplateId: asTextId(change.value.message_template_id),
    name,
    language,
  }
}

// Solo llega con `reason: "INVALID_FORMAT"`. Se cuelga de `reason`, que es el
// campo obligatorio del objeto: sin él no hay explicación que dar y el resto es
// decoración.
function readRejection(value: unknown): WhatsappTemplateRejection | null {
  const info = asRecord(value)
  const reason = asString(info?.reason)
  if (!reason) return null

  return { reason, recommendation: asString(info?.recommendation) }
}
