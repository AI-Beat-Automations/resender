import type {
  AttachmentStatus,
  DeliveryStatus,
  MessageAttachmentType,
  MessageOrigin,
} from "@/lib/messages/message-enums"

// Tipos públicos de los parsers del webhook de WhatsApp Cloud API. Viven en su
// propio módulo porque los parsers de mensajería (`messages`, `statuses`,
// `history`, `smb_app_state_sync`, `smb_message_echoes`) y los tres de
// plantilla se los pasan entre sí, y el barril `index.ts` los reexporta para el
// que cablea la ingesta.

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

// Todo lo que no es texto. Se corresponde una a una con las columnas
// `attachment_*` de `messages`: un mensaje de Cloud API tiene exactamente un
// `type`, así que la cardinalidad N no hace falta (0017 §5).
//
// Deliberadamente **sin URL**. Desde noviembre de 2025 Meta incluye
// `<type>.url` en el propio payload, pero esa URL caduca a los 5 minutos y va
// autenticada: persistirla deja en la base un secreto de vida corta que además
// nunca volverá a servir. Lo que sobrevive es `providerMediaId`, con el que la
// descarga se pide cuando toca.
export type WhatsappAttachment = {
  // El único discriminador de contenido de la fila (0017 §6). No hay
  // `message_type` aparte: dos discriminadores diciendo lo mismo con distinto
  // vocabulario es exactamente lo que la migración decidió no tener.
  type: MessageAttachmentType
  // Va **dentro** de `attachment_meta` al persistir y se separa de vuelta al
  // armar el push (`insertInboundMessage` / `buildInboundPushPayload`). Hoy
  // WhatsApp no informa ninguno —el pie de foto es el texto del mensaje, no un
  // título—, pero el campo existe para que la fila se escriba con el mismo
  // split que las de Messenger e Instagram y no haya dos convenciones.
  title: string | null
  // Lo que varía por tipo, tal cual va a `attachment_meta` (jsonb). Claves
  // opcionales y sin nulos: que una clave no esté significa que este payload no
  // la trajo, que es distinto de traerla vacía.
  details: Record<string, unknown>
  // El ID de media de Meta, lo único con lo que se puede pedir la descarga
  // después. Null cuando no hay binario recuperable. Se duplica dentro de
  // `details` a propósito: el job de descarga que se reintenta lee la fila, no
  // este objeto.
  providerMediaId: string | null
  // Lo que el llamador tiene que escribir en `attachment_status`, y por tanto
  // también si encola o no una descarga:
  //   `pending`     → hay `providerMediaId`, se encola.
  //   `unavailable` → hay binario pero Meta no lo ofrece (historial de más de
  //                   14 días): se marca y **no se encola nada**.
  //   `null`        → no hay binario que bajar (ubicación, tarjeta, reacción,
  //                   respuesta interactiva, pedido, evento de sistema).
  status: Extract<AttachmentStatus, "pending" | "unavailable"> | null
}

// Un mensaje ya normalizado, venga de donde venga. Los tres orígenes
// —`messages`, `smb_message_echoes` y `history`— describen el mismo hecho con
// tres formas distintas, y unificarlos aquí es lo que permite que la ingesta
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
  // el número conectado, contra `connected_pages.meta_page_id`, que para este
  // canal guarda justamente el `phone_number_id` (0017 §2). No se enruta por
  // `display_phone_number` (cosmético) ni por el WABA (no distingue entre
  // varios números de la misma cuenta).
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
  // es trabajo de la ingesta, que tiene la tabla de contactos delante.
  senderId: string
  // `value.contacts[].profile.name`, cruzado por `wa_id`. Null cuando el
  // payload no trae `contacts` — pasa en `system`, en los echoes y en todo el
  // historial.
  contactName: string | null
  // El `wamid`, que es lo que va a la columna `meta_message_id` y lo que
  // deduplica los reintentos de Meta.
  metaMessageId: string
  // El `body` del texto o el `caption` del adjunto, y nada más. Los tipos que
  // no llevan texto propio (ubicación, pedido, botón, evento de sistema) lo
  // dejan en null: fabricarles un texto legible aquí convertiría una decisión
  // de presentación en un dato persistido e irreversible.
  text: string | null
  // Null **solo** en un mensaje de texto. Cualquier otra cosa —incluido un
  // tipo que Meta invente mañana— llega con adjunto, aunque sea de tipo
  // `unknown`: un tipo nuevo no puede romper el lote ni disfrazarse de texto.
  attachment: WhatsappAttachment | null
  // `context.id`, la columna `reply_to_meta_message_id`. Ojo: una reacción
  // **no** usa `context`; su vínculo va en `reaction.message_id` y por tanto
  // acaba en `attachment.details`, no aquí.
  replyToMetaMessageId: string | null
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
  metaMessageId: string
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

// El texto legible que Meta adjunta cuando rechaza por `INVALID_FORMAT`. Es lo
// único que explica el rechazo en prosa —el `reason` es una constante de su
// catálogo— y por tanto lo único que le sirve al cliente para arreglar la
// plantilla en vez de adivinar.
export type WhatsappTemplateRejection = {
  reason: string
  recommendation: string | null
}

// Los tres campos de plantilla (`message_template_status_update`,
// `template_category_update` y `message_template_quality_update`) en **un solo
// tipo con discriminante**, y no en tres tipos con tres arrays en el lote.
//
// El motivo es el efecto río abajo: los tres terminan en el mismo `update` del
// espejo por `(waba_id, name, language)` (ADR 0014). Tres listas obligarían al
// consumidor a escribir tres bucles que resuelven la misma fila de tres
// maneras, que es justo lo que `WhatsappMessageEvent` ya evitó unificando sus
// tres orígenes en una sola forma. El contraste está en `WhatsappStatusEvent`,
// que sí vive aparte de los mensajes: ahí los efectos son distintos —uno crea
// fila y el otro actualiza una columna— y unificarlos habría mentido.
//
// La identidad es la clave del espejo, así que **es obligatoria**: sin WABA,
// nombre e idioma no hay fila que actualizar y el evento no es accionable. Eso
// no contradice la tolerancia con el `status` de más abajo; son dos cosas
// distintas, y el parser distingue entre no saber a qué fila apunta un evento
// (se descarta) y no reconocer el valor que trae (se conserva).
export type WhatsappTemplateEvent = {
  // Requerido, al revés que en `WhatsappMessageEvent`, donde el WABA es
  // decorativo. Aquí es un tercio de la clave.
  wabaId: string
  // El `message_template_id` de Meta, que viaja como **número** en el JSON. Es
  // lo único con lo que se borra una sola versión de idioma —el DELETE por
  // nombre se lleva todas— y por eso el espejo lo guarda como
  // `meta_template_id`. Null si el payload no lo trajo: no es clave, es un dato
  // que se completa cuando aparece.
  metaTemplateId: string | null
  // `message_template_name` y `message_template_language`, literales. **No se
  // normalizan**: son dos tercios de la clave del espejo y reescribirlos aquí
  // sería inventar una clave que no es la de nadie.
  //
  // Aviso para quien escriba el `update`: los ejemplos de estos webhooks traen
  // el idioma con guion (`en-US`, y también `en` a secas), mientras que Graph
  // devuelve el catálogo con guion bajo (`en_US`). Si las dos formas son reales
  // el `update` por clave no encontraría nunca la fila que insertó el sync, y
  // el espejo se quedaría congelado **en silencio**. La decisión de cómo
  // comparar es de quien conoce las dos puntas; aquí no se adivina.
  name: string
  language: string
} & (
  | {
      kind: "status"
      // El `event` de Meta, **crudo y sin catálogo**. La columna `status` del
      // espejo no tiene check constraint a propósito (ADR 0014): la propia
      // documentación de Meta se contradice entre `PENDING` e `IN_REVIEW` y
      // añade valores como `LIMIT_EXCEEDED` sin cambiar de versión de API. Un
      // estado que no reconocemos deja el espejo menos exacto; descartarlo lo
      // deja **desactualizado**, que es peor, porque el envío decide contra él.
      //
      // Por eso este parser no se parece a `statuses.ts`, que sí descarta lo
      // que no sabe mapear: allí la columna tiene un CHECK y un valor de
      // relleno rompería el insert del lote entero. Aquí no hay tal CHECK, así
      // que no hay nada que proteger tirando el dato. La normalización a
      // `unknown` —si hace falta— es del módulo de lectura, no de aquí.
      status: string
      // El `reason` del catálogo de Meta. `NONE` es un valor real suyo —«la
      // plantilla se pausó»— y no una ausencia, así que se conserva tal cual en
      // vez de traducirse a null: sustituirlo perdería la diferencia entre «vino
      // NONE» y «no vino nada».
      reason: string | null
      // `message_template_category`, que Meta empezó a incluir en este mismo
      // evento. Ahorra esperar al `template_category_update` para refrescar la
      // categoría cuando la aprobación ya la trae.
      category: string | null
      rejection: WhatsappTemplateRejection | null
    }
  | {
      kind: "category"
      // Siempre `new_category`, en las **dos** variantes de este webhook, y no
      // por casualidad: Meta lo documenta como «the template's new/current
      // category». En el aviso de recategorización inminente trae la categoría
      // que la plantilla tiene ahora, y en el de recategorización consumada la
      // que acaba de estrenar. Escribir esto en el espejo es correcto siempre.
      //
      // Es la trampa del campo: `correct_category` **no** es la categoría
      // actual sino la futura, y guardarla adelantaría un cambio que todavía no
      // ocurrió.
      category: string
      previousCategory: string | null
      // `correct_category` y `category_update_timestamp`: la categoría a la que
      // Meta va a mover la plantilla y cuándo. Informativos —para avisar en la
      // consola, no para escribir el espejo— y null en la variante consumada.
      pendingCategory: string | null
      pendingAt: Date | null
    }
  | {
      kind: "quality"
      // `GREEN` | `YELLOW` | `RED` | `UNKNOWN`, sin catálogo cerrado por el
      // mismo motivo que `status`.
      //
      // No hay columna donde guardar esto y no la va a haber: el valor de este
      // evento es que una caída de calidad **llegue a la bitácora antes de que
      // Meta pause el número** (ADR 0014). Como no hay tope local de plantillas
      // hacia contactos que nunca contestaron, es el único freno del que nos
      // enteramos, y por eso se emite aunque nadie lo persista.
      qualityScore: string
      previousQualityScore: string | null
    }
)

export type WhatsappWebhookBatch = {
  messages: WhatsappMessageEvent[]
  statuses: WhatsappStatusEvent[]
  history: WhatsappHistoryChunk[]
  contactSync: WhatsappContactSyncEvent[]
  echoes: WhatsappMessageEvent[]
  templates: WhatsappTemplateEvent[]
  // `field`s que llegaron y estos parsers no modelan (`account_update`,
  // `phone_number_quality_update`, `calls`…). Se listan en vez de tragarse para
  // que la ingesta los registre: un campo nuevo de Meta debe aparecer en la
  // bitácora, no desaparecer.
  unhandledFields: string[]
}
