import type {
  AttachmentKind,
  DeliveryStatus,
  MessageContent,
  MessageOrigin,
  MessageType,
} from "@workspace/contracts"

// Parsers de dominio del webhook de WhatsApp Cloud API. Código puro: sin I/O,
// sin base de datos y sin llamadas a Meta —ni siquiera para resolver media—,
// porque el webhook se contesta con 200 antes de tocar nada.
//
// El sobre **no** es `entry[].messaging[]` como Messenger e Instagram, sino
// `entry[].changes[].value`, y el mismo POST puede agregar hasta 1000 updates
// de campos distintos. Por eso todo se itera y nada asume `entry[0]`.
//
// Regla transversal, heredada de los otros canales: **nunca lanza**. Lo que no
// se entiende se descarta (`continue`) salvo los mensajes, que se conservan
// como `unknown` con el payload en crudo — un mensaje perdido en silencio es
// una conversación que el tenant nunca ve.

// ─── Tipos públicos ──────────────────────────────────────────────────────────

// Error de Meta, ya aplanado. Viaja en tres sitios distintos con la misma
// forma: colgando de un mensaje `unsupported`, de un status `failed` y de un
// chunk de `history` rechazado.
export type WhatsappError = {
  // Número, no string, en el JSON de Meta.
  code: number | null
  title: string | null
  message: string | null
  details: string | null
}

// Adjunto tal y como viaja en el webhook, deliberadamente **sin URL**. Desde
// noviembre de 2025 Meta incluye `<type>.url` en el propio payload, pero esa
// URL caduca a los 5 minutos y va autenticada: persistirla deja en la base un
// secreto de vida corta que además nunca volverá a servir. Lo que sobrevive es
// `providerMediaId`, con el que la descarga se pide cuando toca.
export type WhatsappAttachment = {
  kind: AttachmentKind
  providerMediaId: string
  mimeType: string | null
  sha256: string | null
  filename: string | null
  caption: string | null
  // `true` = nota de voz (el usuario mantuvo pulsado el micro), `false` =
  // fichero de audio adjuntado. Meta documenta los dos valores explícitos, así
  // que la ausencia del campo (null) no significa `false`: significa que este
  // payload no lo dice.
  voice: boolean | null
  animated: boolean | null
}

// Un mensaje ya normalizado, venga de donde venga. Los tres orígenes
// —`messages`, `smb_message_echoes` y `history`— describen el mismo hecho con
// tres formas distintas, y unificarlos aquí es lo que permite que el servicio
// tenga una sola ruta de persistencia en vez de tres casi iguales.
export type WhatsappMessageEvent = {
  // `entry[].id`. En Coexistence es el WABA del cliente onboardeado, no el
  // nuestro.
  //
  // **Nullable a propósito.** Nadie enruta por él —eso lo hace
  // `providerPhoneNumberId`— y el sobre que sale al webhook del tenant lleva el
  // WABA de la columna `connected_pages.waba_id`, no el del evento. Si Meta lo
  // manda como número, o directamente no lo manda, el dato que se pierde es
  // informativo; los mensajes del `entry` no.
  wabaId: string | null
  // `value.metadata.phone_number_id`: el identificador con el que se resuelve
  // el número conectado. No se enruta por `display_phone_number` (cosmético) ni
  // por el WABA (no distingue entre varios números de la misma cuenta).
  providerPhoneNumberId: string
  direction: "inbound" | "outbound"
  // El interlocutor humano, **siempre el cliente**, apunte donde apunte la
  // dirección. En los echoes sale de `to` y no de `from`, porque ahí `from` es
  // el número del negocio.
  contactId: string
  // Quien emitió el mensaje, literal. Coincide con `contactId` en los
  // entrantes y es el número del negocio en los echoes.
  //
  // Ambos se conservan tal cual los manda Meta, sin quitar el `+` ni
  // recomponerlos: la propia documentación se contradice sobre el formato y
  // avisa de que `wa_id` y `from` pueden no coincidir. Reescribirlos aquí es
  // arriesgarse a contestarle a un número que no existe; unificar identidades
  // es trabajo del servicio, que tiene la tabla de contactos delante.
  senderId: string
  // `value.contacts[].profile.name`, cruzado por `wa_id`. Null cuando el
  // payload no trae `contacts` — pasa en `system`, en los echoes y en todo el
  // historial.
  contactName: string | null
  providerMessageId: string
  type: MessageType
  // El `body` del texto o el `caption` del adjunto, y nada más. Los tipos que
  // no llevan texto propio (ubicación, pedido, botón, evento de sistema) lo
  // dejan en null: fabricarles un texto legible aquí convertiría una decisión
  // de presentación en un dato persistido e irreversible.
  text: string | null
  content: MessageContent | null
  attachments: WhatsappAttachment[]
  // `context.id`. Ojo: una reacción **no** usa `context`; su vínculo va en
  // `reaction.message_id` y por tanto acaba en `content`, no aquí.
  replyToProviderMessageId: string | null
  origin: MessageOrigin
  historical: boolean
  // Solo informado en el historial, donde cada mensaje llega con el estado que
  // ya tenía en el móvil. En los entrantes en vivo el estado llega aparte, por
  // `value.statuses[]`.
  deliveryStatus: DeliveryStatus | null
  errors: WhatsappError[]
  createdAt: Date
}

// En el historial el hilo se identifica por el teléfono del interlocutor, no
// por un ID opaco de conversación.
export type WhatsappHistoryEvent = WhatsappMessageEvent & {
  threadId: string | null
}

// Un elemento de `value.history[]`. Se devuelve el chunk entero y no una lista
// plana de mensajes porque `progress === 100` es la **única** señal documentada
// de que la sincronización terminó, y llega en el chunk: aplanar los mensajes
// tiraría el dato que cierra el onboarding.
export type WhatsappHistoryChunk = {
  // Nullable por el mismo motivo que en `WhatsappMessageEvent`.
  wabaId: string | null
  providerPhoneNumberId: string
  // Null en el webhook de IDs de media (§6.1.2), que llega sin metadata.
  phase: number | null
  chunkOrder: number | null
  progress: number | null
  // Informado cuando el negocio tiene desactivado el compartir historial: el
  // chunk llega sin `metadata` ni `threads`, solo con el error.
  errors: WhatsappError[]
  messages: WhatsappHistoryEvent[]
}

export type WhatsappStatusEvent = {
  wabaId: string | null
  providerPhoneNumberId: string
  // El `wamid` del mensaje que enviamos nosotros.
  providerMessageId: string
  deliveryStatus: DeliveryStatus
  // Teléfono del usuario o ID del grupo.
  recipientId: string | null
  timestamp: Date
  // Solo con `failed`. Sin esto el diagnóstico se pierde y todos los fallos de
  // envío quedan indistinguibles entre sí.
  errors: WhatsappError[]
}

export type WhatsappContactSyncEvent = {
  wabaId: string | null
  providerPhoneNumberId: string
  // Solo `add` y `remove`. Una **edición** de contacto llega como `add`, así
  // que el consumidor tiene que hacer upsert: un insert a secas revienta con la
  // segunda edición del mismo teléfono.
  action: "add" | "remove"
  // La clave. Es lo único que viaja en un `remove`, así que la deduplicación de
  // contactos se hace por teléfono y nunca por nombre.
  phoneNumber: string
  fullName: string | null
  firstName: string | null
  timestamp: Date
}

export type WhatsappWebhookBatch = {
  messages: WhatsappMessageEvent[]
  statuses: WhatsappStatusEvent[]
  history: WhatsappHistoryChunk[]
  contactSync: WhatsappContactSyncEvent[]
  echoes: WhatsappMessageEvent[]
  // `field`s que llegaron y este parser no modela (`account_update`,
  // `message_template_status_update`, `calls`…). Se listan en vez de tragarse
  // para que el servicio los registre: un campo nuevo de Meta debe aparecer en
  // la bitácora, no desaparecer.
  unhandledFields: string[]
}

// ─── Entrada única ───────────────────────────────────────────────────────────

// Recorre el lote una sola vez y lo agrupa por `field`. Es la puerta que usa el
// servicio: un `field` desconocido cae en el `default` y no impide que el resto
// del lote se procese, que es justo lo que no se consigue si cada consumidor
// filtra por su cuenta.
export function parseWhatsappWebhook(value: unknown): WhatsappWebhookBatch {
  const batch: WhatsappWebhookBatch = {
    messages: [],
    statuses: [],
    history: [],
    contactSync: [],
    echoes: [],
    unhandledFields: [],
  }

  for (const change of collectChanges(value)) {
    switch (change.field) {
      case "messages":
        // El mismo `field` trae mensajes entrantes y acuses de los que
        // enviamos nosotros, en dos arrays independientes que pueden venir a la
        // vez o faltar los dos (un `value` con solo `errors` es legal).
        batch.messages.push(...readInboundMessages(change))
        batch.statuses.push(...readStatuses(change))
        break
      case "history":
        batch.history.push(...readHistory(change))
        break
      case "smb_app_state_sync":
        batch.contactSync.push(...readContactSync(change))
        break
      case "smb_message_echoes":
        batch.echoes.push(...readEchoes(change))
        break
      default:
        if (!batch.unhandledFields.includes(change.field)) {
          batch.unhandledFields.push(change.field)
        }
    }
  }

  return batch
}

// Los cinco extractores por tipo de evento existen para que el servicio (y los
// tests) puedan pedir una sola cosa sin destructurar el lote entero. Se apoyan
// en el mismo recorrido para que no haya dos definiciones de qué cuenta como
// mensaje válido.

export function extractWhatsappMessages(
  value: unknown
): WhatsappMessageEvent[] {
  return parseWhatsappWebhook(value).messages
}

export function extractWhatsappStatuses(value: unknown): WhatsappStatusEvent[] {
  return parseWhatsappWebhook(value).statuses
}

export function extractWhatsappHistory(value: unknown): WhatsappHistoryChunk[] {
  return parseWhatsappWebhook(value).history
}

export function extractWhatsappContactSync(
  value: unknown
): WhatsappContactSyncEvent[] {
  return parseWhatsappWebhook(value).contactSync
}

export function extractWhatsappEchoes(value: unknown): WhatsappMessageEvent[] {
  return parseWhatsappWebhook(value).echoes
}

// ─── Sobre ───────────────────────────────────────────────────────────────────

type WhatsappChange = {
  wabaId: string | null
  field: string
  value: Record<string, unknown>
  providerPhoneNumberId: string
  // `metadata.display_phone_number`, el número del negocio. Solo se usa para
  // deducir la dirección de los mensajes del historial que llegan sin hilo.
  businessPhoneNumber: string | null
}

function collectChanges(body: unknown): WhatsappChange[] {
  const root = asRecord(body)
  if (!root) return []

  const changes: WhatsappChange[] = []
  for (const rawEntry of asArray(root.entry)) {
    const entry = asRecord(rawEntry)
    // Un `entry` que no tiene forma de objeto no lleva `changes` que recorrer:
    // eso sí es basura y se descarta. **La falta de `entry.id` no lo es.** El
    // WABA no enruta nada —de eso se encarga `metadata.phone_number_id`— y
    // nadie lo consume aguas abajo, así que tirar el `entry` entero por él
    // significaría perder todos sus mensajes reales, sin un solo log, por un
    // campo decorativo. Basta con que llegue en null; `asString` ya lo deja así
    // cuando Meta lo manda como número en vez de como string.
    if (!entry) continue
    const wabaId = asString(entry.id)

    for (const rawChange of asArray(entry.changes)) {
      const change = asRecord(rawChange)
      // `field` no se adivina a partir de la forma del `value` aunque falte.
      // `messages[]` significa "mensaje entrante" bajo `field: "messages"` y
      // "ID de media del historial" bajo `field: "history"`, y confundirlos
      // haría que un mensaje de hace seis meses abriera la ventana de 24 h y se
      // reenviara al webhook del tenant como si acabara de llegar. Descartar es
      // peor que acertar, pero mucho mejor que equivocarse callado.
      const field = asString(change?.field)
      const value = asRecord(change?.value)
      if (!field || !value) continue

      const metadata = asRecord(value.metadata)
      const providerPhoneNumberId = asString(metadata?.phone_number_id)
      // Sin `phone_number_id` no hay número conectado al que atribuir el
      // evento, y por tanto tampoco tenant: no hay nada que hacer con él.
      if (!providerPhoneNumberId) continue

      changes.push({
        wabaId,
        field,
        value,
        providerPhoneNumberId,
        businessPhoneNumber: asString(metadata?.display_phone_number),
      })
    }
  }

  return changes
}

// ─── `field: "messages"` ─────────────────────────────────────────────────────

function readInboundMessages(change: WhatsappChange): WhatsappMessageEvent[] {
  const profileNames = readProfileNames(change.value.contacts)
  const events: WhatsappMessageEvent[] = []

  for (const raw of asArray(change.value.messages)) {
    const message = asRecord(raw)
    const from = asString(message?.from)
    const providerMessageId = asString(message?.id)
    if (!message || !from || !providerMessageId) continue

    const interpreted = interpretMessage(message)
    events.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      direction: "inbound",
      contactId: from,
      senderId: from,
      contactName: profileNames.get(digitsOf(from)) ?? null,
      providerMessageId,
      ...interpreted,
      replyToProviderMessageId: asString(asRecord(message.context)?.id),
      // Un `user_changed_number` no lo escribió el cliente: lo genera WhatsApp
      // cuando alguien se cambia de número. Marcarlo como `customer` lo metería
      // en la conversación como si el contacto hubiera hablado.
      origin: interpreted.type === "system" ? "system" : "customer",
      historical: false,
      deliveryStatus: null,
      errors: readErrors(message.errors),
      createdAt: normalizeTimestamp(message.timestamp),
    })
  }

  return events
}

// `value.contacts[]` (el perfil de quien escribe) no tiene nada que ver con
// `messages[].contacts[]` (una tarjeta de contacto compartida): mismo nombre,
// significados opuestos. Y no siempre viene aunque haya mensajes — el ejemplo
// oficial de `system` llega sin él.
function readProfileNames(value: unknown): Map<string, string> {
  const names = new Map<string, string>()
  for (const raw of asArray(value)) {
    const contact = asRecord(raw)
    const waId = asString(contact?.wa_id)
    const name = asString(asRecord(contact?.profile)?.name)
    // Se indexa por dígitos porque las tablas de Meta documentan `wa_id` sin
    // `+` y `from` con `+`, mientras que sus propios ejemplos JSON los mandan
    // los dos sin `+`. Comparar en crudo dejaría sin nombre a media base de
    // contactos el día que la doc deje de contradecirse.
    if (waId && name) names.set(digitsOf(waId), name)
  }
  return names
}

function readStatuses(change: WhatsappChange): WhatsappStatusEvent[] {
  const events: WhatsappStatusEvent[] = []

  for (const raw of asArray(change.value.statuses)) {
    const status = asRecord(raw)
    const providerMessageId = asString(status?.id)
    const reported = asString(status?.status)
    if (!status || !providerMessageId || !reported) continue

    const deliveryStatus = DELIVERY_STATUS_BY_REPORTED[reported]
    // Un valor que no sabemos mapear se descarta en vez de inventarle uno: la
    // columna tiene un CHECK y un valor de relleno rompería el insert de todo
    // el lote. Meta añade valores sin cambiar de versión de API, así que este
    // camino se recorrerá antes o después.
    if (!deliveryStatus) continue

    events.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      providerMessageId,
      deliveryStatus,
      recipientId: asString(status.recipient_id),
      timestamp: normalizeTimestamp(status.timestamp),
      errors: readErrors(status.errors),
    })
  }

  return events
}

// ─── `field: "history"` ──────────────────────────────────────────────────────

function readHistory(change: WhatsappChange): WhatsappHistoryChunk[] {
  const chunks: WhatsappHistoryChunk[] = []

  for (const raw of asArray(change.value.history)) {
    const chunk = asRecord(raw)
    if (!chunk) continue

    const metadata = asRecord(chunk.metadata)
    const messages: WhatsappHistoryEvent[] = []
    for (const rawThread of asArray(chunk.threads)) {
      const thread = asRecord(rawThread)
      if (!thread) continue
      const threadId = asString(thread.id)
      for (const rawMessage of asArray(thread.messages)) {
        const event = readHistoryMessage(change, asRecord(rawMessage), threadId)
        if (event) messages.push(event)
      }
    }

    chunks.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      phase: asNumber(metadata?.phase),
      chunkOrder: asNumber(metadata?.chunk_order),
      progress: asNumber(metadata?.progress),
      errors: readErrors(chunk.errors),
      messages,
    })
  }

  // La segunda forma del mismo `field`. Los mensajes multimedia del historial
  // llegan primero como `media_placeholder` sin ID de asset, y los IDs se
  // mandan después en webhooks aparte que **rompen la forma**: siguen siendo
  // `field: "history"` pero cuelgan de `value.messages[]`, no de
  // `value.history[]`. Por eso se discrimina por la presencia del array y no
  // por el `field`, y por eso el chunk resultante no tiene metadata que
  // reportar.
  //
  // El placeholder se conserva (entra como `unknown` con
  // `eventType: "media_placeholder"`), pero **hoy nadie lo reconcilia**: la
  // ingesta solo sabe insertar, así que este segundo webhook trae el mismo
  // `wamid` que el placeholder, choca con el dedupe y se descarta — el
  // multimedia del historial se pierde. Casarlos por `wamid` es requisito del
  // slice que active Coexistence, junto con el de media.
  const mediaMessages: WhatsappHistoryEvent[] = []
  for (const raw of asArray(change.value.messages)) {
    const event = readHistoryMessage(change, asRecord(raw), null)
    if (event) mediaMessages.push(event)
  }
  if (mediaMessages.length > 0) {
    chunks.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      phase: null,
      chunkOrder: null,
      progress: null,
      errors: [],
      messages: mediaMessages,
    })
  }

  return chunks
}

function readHistoryMessage(
  change: WhatsappChange,
  message: Record<string, unknown> | null,
  threadId: string | null
): WhatsappHistoryEvent | null {
  const from = asString(message?.from)
  const providerMessageId = asString(message?.id)
  if (!message || !from || !providerMessageId) return null

  // El hilo ya identifica al interlocutor cuando viene. Cuando no —la forma de
  // IDs de media—, hay que deducirlo comparando contra el número del negocio,
  // que es el único referente disponible; `to` solo aparece en la sintaxis, no
  // en los ejemplos, así que no se puede depender de él.
  const contactId =
    threadId ??
    (samePhone(from, change.businessPhoneNumber) ? asString(message.to) : from)
  if (!contactId) return null

  const interpreted = interpretMessage(message)
  return {
    wabaId: change.wabaId,
    providerPhoneNumberId: change.providerPhoneNumberId,
    direction: samePhone(from, contactId) ? "inbound" : "outbound",
    contactId,
    senderId: from,
    contactName: null,
    providerMessageId,
    ...interpreted,
    replyToProviderMessageId: asString(asRecord(message.context)?.id),
    origin: "history",
    // Lo importado no abre ventana de 24 h ni se reenvía al webhook externo.
    historical: true,
    deliveryStatus: readHistoryDeliveryStatus(message.history_context),
    errors: readErrors(message.errors),
    // `<DEVICE_TIMESTAMP>`: la hora del móvil, no la del webhook. Es lo que
    // hace que el historial se ordene donde le toca y no todo junto al final.
    createdAt: normalizeTimestamp(message.timestamp),
    threadId,
  }
}

// ─── `field: "smb_app_state_sync"` ───────────────────────────────────────────

function readContactSync(change: WhatsappChange): WhatsappContactSyncEvent[] {
  const events: WhatsappContactSyncEvent[] = []

  // El array se llama `state_sync[]`, no `contacts[]`.
  for (const raw of asArray(change.value.state_sync)) {
    const item = asRecord(raw)
    const contact = asRecord(item?.contact)
    const phoneNumber = asString(contact?.phone_number)
    const action = asString(item?.action)
    if (!phoneNumber || (action !== "add" && action !== "remove")) continue

    events.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      action,
      phoneNumber,
      // Ninguno de los dos viene en un `remove`.
      fullName: asString(contact?.full_name),
      firstName: asString(contact?.first_name),
      // `state_sync[].metadata` (con `timestamp`) no es `value.metadata` (con
      // `phone_number_id`), otra colisión de nombres de las de Meta.
      timestamp: normalizeTimestamp(asRecord(item?.metadata)?.timestamp),
    })
  }

  return events
}

// ─── `field: "smb_message_echoes"` ───────────────────────────────────────────

function readEchoes(change: WhatsappChange): WhatsappMessageEvent[] {
  const events: WhatsappMessageEvent[] = []

  for (const raw of asArray(change.value.message_echoes)) {
    const echo = asRecord(raw)
    // **La dirección va al revés que en `messages[]`**: aquí `from` es el
    // número del negocio y `to` el del cliente, porque son mensajes que el
    // negocio mandó desde la app móvil o un dispositivo vinculado. Leer `from`
    // como si fuera el contacto crearía una conversación con el propio negocio.
    const from = asString(echo?.from)
    const to = asString(echo?.to)
    const providerMessageId = asString(echo?.id)
    if (!echo || !from || !to || !providerMessageId) continue

    const interpreted = interpretMessage(echo)
    events.push({
      wabaId: change.wabaId,
      providerPhoneNumberId: change.providerPhoneNumberId,
      direction: "outbound",
      contactId: to,
      senderId: from,
      contactName: null,
      providerMessageId,
      ...interpreted,
      replyToProviderMessageId: asString(asRecord(echo.context)?.id),
      // Distinguirlos de `resender_api` es lo que evita que el sistema se
      // automatice sobre sí mismo: un echo no es una respuesta nuestra.
      origin: "business_app",
      historical: false,
      deliveryStatus: null,
      errors: readErrors(echo.errors),
      createdAt: normalizeTimestamp(echo.timestamp),
    })
  }

  return events
}

// ─── Interpretación del cuerpo del mensaje ───────────────────────────────────

type InterpretedMessage = {
  type: MessageType
  text: string | null
  content: MessageContent | null
  attachments: WhatsappAttachment[]
}

// Los cinco tipos que se materializan como adjunto. Van por `attachments[]` y
// dejan `content` en null: el contrato no tiene variante de media a propósito,
// porque el binario no vive en la fila del mensaje.
const ATTACHMENT_KINDS: Record<string, AttachmentKind> = {
  image: "image",
  audio: "audio",
  video: "video",
  document: "document",
  sticker: "sticker",
}

function interpretMessage(
  message: Record<string, unknown>
): InterpretedMessage {
  // Todo tipo trae un objeto homónimo (`type: "image"` ⇒ `image: {…}`). La
  // única excepción es `contacts`, que es un array.
  const reported = asString(message.type) ?? ""
  const payload = message[reported]

  const kind = ATTACHMENT_KINDS[reported]
  if (kind) {
    const media = asRecord(payload)
    const providerMediaId = asString(media?.id)
    return {
      type: kind,
      // Audio y sticker no admiten pie de foto; imagen, vídeo y documento sí,
      // y solo llega si el usuario lo escribió (la tabla de Meta lo marca como
      // no opcional, pero es un error evidente de la doc).
      text: asString(media?.caption),
      content: null,
      attachments:
        media && providerMediaId
          ? [
              {
                kind,
                providerMediaId,
                mimeType: asString(media.mime_type),
                sha256: asString(media.sha256),
                filename: asString(media.filename),
                caption: asString(media.caption),
                voice: asBoolean(media.voice),
                animated: asBoolean(media.animated),
              },
            ]
          : [],
    }
  }

  switch (reported) {
    case "text":
      return plain("text", asString(asRecord(payload)?.body))

    case "location": {
      const location = asRecord(payload)
      const latitude = asNumber(location?.latitude)
      const longitude = asNumber(location?.longitude)
      // Latitud y longitud son números JSON, a diferencia de `timestamp`, que
      // es string. Sin las dos no hay variante `location` que construir, así
      // que el payload se conserva en crudo antes que fabricar un punto falso.
      if (latitude === null || longitude === null) {
        return typed("location", genericContent(reported, payload))
      }
      return typed("location", {
        kind: "location",
        latitude,
        longitude,
        // Una ubicación cruda soltada en el mapa no trae ni nombre ni
        // dirección; solo los sitios con ficha los traen.
        name: asString(location?.name),
        address: asString(location?.address),
      })
    }

    case "contacts": {
      const cards = asArray(payload).flatMap(readSharedContact)
      if (cards.length === 0) {
        return typed("contacts", genericContent(reported, payload))
      }
      return typed("contacts", { kind: "contacts", contacts: cards })
    }

    case "reaction": {
      const reaction = asRecord(payload)
      const targetProviderMessageId = asString(reaction?.message_id)
      if (!targetProviderMessageId) {
        return typed("reaction", genericContent(reported, payload))
      }
      return typed("reaction", {
        kind: "reaction",
        // **La ausencia de `emoji` ES la señal de reacción retirada.** No hay
        // ningún flag: si el usuario quita su reacción llega otro webhook igual
        // pero sin la propiedad.
        emoji: asString(reaction?.emoji),
        targetProviderMessageId,
      })
    }

    case "interactive": {
      const interactive = asRecord(payload)
      return typed("interactive", {
        kind: "interactive",
        // `list_reply` y `button_reply` son los dos únicos documentados, pero
        // las respuestas de Flows (`nfm_reply`) existen y no están en esa
        // página. Se guarda el discriminador como string libre en vez de
        // cerrarlo, y el payload entero detrás.
        interactiveType: asString(interactive?.type) ?? "unknown",
        payload: stripMediaUrls(payload),
      })
    }

    case "button":
      // Un botón de respuesta rápida de una **plantilla**, que Meta manda como
      // tipo propio y no como `interactive.button_reply` (ése es el botón de un
      // mensaje interactivo que enviamos nosotros). No existe en
      // `MessageTypeSchema` y tampoco merece uno: es la misma clase de hecho
      // —el usuario pulsó algo que le ofrecimos—, así que entra como
      // `interactive` con el discriminador `button` y el payload conservado.
      // Nótese que `button.payload` **es** la etiqueta del botón, no un
      // identificador nuestro: Meta documenta `payload` y `text` con el mismo
      // placeholder.
      return typed("interactive", {
        kind: "interactive",
        interactiveType: "button",
        payload: stripMediaUrls(payload),
      })

    case "order":
    case "system":
      // Pedidos y eventos de sistema tienen tipo propio en el contrato, pero
      // ninguna variante de `content` que los describa. Se conservan enteros
      // como `generic_event` en vez de aplanarlos a un texto legible: el texto
      // sería una interpretación nuestra irreversible, y el importe de un
      // pedido o el nuevo `wa_id` de un cambio de número se necesitan como
      // datos, no como frase.
      return typed(reported, genericContent(reported, payload))

    case "unsupported":
      // Encuestas, mensajes fijados, invitaciones a grupo y ediciones del
      // usuario llegan todos por aquí. Cloud API no sabe leerlos y nosotros
      // tampoco, pero el hecho de que existan sí importa: el `errors[]` que los
      // acompaña queda en el evento y distingue "tipo desconocido" (131051) del
      // primer mensaje a un número de Coexistence (131060).
      return typed("unknown", genericContent(reported, payload))

    default:
      // **Ningún mensaje desconocido se pierde en silencio.** Meta añade tipos
      // sin cambiar de versión de API: descartarlos dejaría huecos mudos en la
      // conversación del tenant, imposibles de detectar y de recuperar después.
      // `eventType` guarda el string literal que mandó Meta —incluido
      // `media_placeholder`, que solo existe en el historial— para que se pueda
      // medir qué está llegando antes de decidir si merece modelarse.
      return typed("unknown", genericContent(reported, payload))
  }
}

function plain(type: MessageType, text: string | null): InterpretedMessage {
  return { type, text, content: null, attachments: [] }
}

function typed(type: MessageType, content: MessageContent): InterpretedMessage {
  return { type, text: null, content, attachments: [] }
}

function genericContent(reported: string, payload: unknown): MessageContent {
  return {
    kind: "generic_event",
    eventType: reported || "unknown",
    raw: stripMediaUrls(payload) ?? null,
  }
}

function readSharedContact(
  raw: unknown
): Array<{ name: string; phones: string[]; raw: unknown }> {
  const card = asRecord(raw)
  if (!card) return []

  const name = asRecord(card.name)
  const composed = [asString(name?.first_name), asString(name?.last_name)]
    .filter((part): part is string => part !== null)
    .join(" ")

  return [
    {
      // Lo único razonablemente presente es `formatted_name`; el resto de la
      // tarjeta es opcional en la práctica aunque la sintaxis la muestre
      // entera.
      name: asString(name?.formatted_name) ?? composed,
      // Llegan como el usuario los tenía escritos ("+1 (415) 555-0829"), no en
      // E.164. Se guardan tal cual: son un dato de la tarjeta, no una identidad
      // con la que enrutar.
      phones: asArray(card.phones)
        .map((phone) => asString(asRecord(phone)?.phone))
        .filter((phone): phone is string => phone !== null),
      raw: stripMediaUrls(card),
    },
  ]
}

// ─── Estados de entrega ──────────────────────────────────────────────────────

const DELIVERY_STATUS_BY_REPORTED: Record<string, DeliveryStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  // Meta emite `played` la primera vez que se reproduce una nota de voz. No
  // está en `DeliveryStatusSchema` ni en el CHECK de la migración 0015, y es
  // monotónicamente equivalente a `read`: el usuario abrió el chat y consumió
  // el mensaje. Se mapea en vez de añadir el valor porque una migración cuyo
  // único aporte es un estado que ninguna vista distingue no se paga sola.
  //
  // `deleted` se queda en el tipo aunque Meta no lo emita nunca por aquí: ya
  // está en el contrato y el borrado llega por otra puerta, el `revoke` de los
  // echoes de Coexistence.
  played: "read",
  failed: "failed",
}

// El historial usa **MAYÚSCULAS** y un enum distinto del de `statuses[]`, con
// dos valores que allí no existen. Compartir la tabla de mapeo dejaría todo el
// historial sin estado de entrega y nadie se enteraría.
const DELIVERY_STATUS_BY_HISTORY_CONTEXT: Record<string, DeliveryStatus> = {
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
  // `PENDING` es "todavía no ha salido del móvil". `accepted` es el primer
  // estado de nuestro enum y el único que no afirma que Meta lo haya enviado.
  PENDING: "accepted",
}

function readHistoryDeliveryStatus(value: unknown): DeliveryStatus | null {
  const reported = asString(asRecord(value)?.status)
  if (!reported) return null
  return DELIVERY_STATUS_BY_HISTORY_CONTEXT[reported] ?? null
}

function readErrors(value: unknown): WhatsappError[] {
  return asArray(value).flatMap((raw) => {
    const error = asRecord(raw)
    if (!error) return []
    return [
      {
        code: asNumber(error.code),
        title: asString(error.title),
        message: asString(error.message),
        details: asString(asRecord(error.error_data)?.details),
      },
    ]
  })
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

// Quita recursivamente cualquier `url` de string de lo que se vaya a persistir
// en `content`. La única URL que Meta mete en estos payloads es la de descarga
// de media —directa en el propio mensaje desde noviembre de 2025, y anidada
// dentro de `edit.message.<type>` en los echoes—, y caduca a los cinco minutos.
// El barrido es a ciegas y por eso se lleva por delante alguna URL inofensiva
// (la web de un negocio en una ubicación citada dentro de un `edit`), pero esa
// pérdida es cosmética y el contrato ya decidió que `location` no guarda URL;
// guardar un enlace firmado que caduca en cinco minutos, en cambio, es un
// secreto muerto en la base de datos.
function stripMediaUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMediaUrls)

  const record = asRecord(value)
  if (!record) return value

  const clean: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    if (key === "url" && typeof item === "string") continue
    clean[key] = stripMediaUrls(item)
  }
  return clean
}

// WhatsApp manda el `timestamp` en **segundos y como string**, mientras que los
// webhooks de mensajes de Messenger e Instagram lo mandan en milisegundos y
// como número. Se distingue por magnitud, igual que en el parser de comentarios
// de Instagram: leer diez dígitos como milisegundos fecha todo en 1970 y
// desordena el hilo entero.
function normalizeTimestamp(value: unknown): Date {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date()

  const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

// La documentación se contradice sobre si los teléfonos llevan `+`: las tablas
// de parámetros lo ponen y los ejemplos JSON no. Comparar por dígitos es lo
// único que sobrevive a las dos formas.
function samePhone(left: string | null, right: string | null): boolean {
  if (!left || !right) return false
  return digitsOf(left) === digitsOf(right)
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, "")
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}
