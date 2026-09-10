import type { MessageAttachmentType } from "@/lib/messages/message-enums"

import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  compact,
  stripMediaUrls,
} from "./coerce"
import type { WhatsappAttachment } from "./types"

// Traduce el cuerpo de un mensaje de Cloud API a las dos cosas que persiste la
// fila: el `text` y el adjunto (`attachment_type` + `attachment_meta` +
// `attachment_status`). Lo usan los tres productores de mensajes —entrantes,
// echoes e historial—, que describen el mismo hecho con tres sobres distintos
// pero traen el cuerpo igual.

export type InterpretedMessage = {
  text: string | null
  attachment: WhatsappAttachment | null
}

// Los cinco tipos que traen binario. `document` entra como `file` porque ya
// estaba en el catálogo y son el mismo concepto (0017 §6).
const MEDIA_TYPES: Record<string, MessageAttachmentType> = {
  image: "image",
  audio: "audio",
  video: "video",
  document: "file",
  sticker: "sticker",
}

// El multimedia del historial llega primero con este tipo y **sin ID de
// asset**; los IDs se mandan después en webhooks aparte. Para lo de más de 14
// días ese segundo webhook no llega nunca: el binario no existe para nosotros y
// hay que marcarlo, no reintentarlo. Es el único tipo desconocido del que sí
// sabemos que había un adjunto detrás.
const HISTORY_MEDIA_PLACEHOLDER = "media_placeholder"

export function interpretMessage(
  message: Record<string, unknown>
): InterpretedMessage {
  // Todo tipo trae un objeto homónimo (`type: "image"` ⇒ `image: {…}`). La
  // única excepción es `contacts`, que es un array.
  const reported = asString(message.type) ?? ""
  const payload = message[reported]

  // El texto es el **único** contenido sin adjunto: `attachment_type` null es
  // exactamente lo que significa «esto es un mensaje de texto».
  if (reported === "text") {
    return { text: asString(asRecord(payload)?.body), attachment: null }
  }

  const mediaType = MEDIA_TYPES[reported]
  if (mediaType) return readMedia(mediaType, payload)

  switch (reported) {
    case "location": {
      const location = asRecord(payload)
      const latitude = asNumber(location?.latitude)
      const longitude = asNumber(location?.longitude)
      // Latitud y longitud son números JSON, a diferencia de `timestamp`, que
      // es string. Sin las dos no hay punto que construir, así que el payload
      // se conserva en crudo antes que fabricar una ubicación falsa.
      if (latitude === null || longitude === null) {
        return typed("location", rawDetails(payload))
      }
      return typed(
        "location",
        compact({
          latitude,
          longitude,
          // Una ubicación cruda soltada en el mapa no trae ni nombre ni
          // dirección; solo los sitios con ficha los traen.
          name: asString(location?.name),
          address: asString(location?.address),
        })
      )
    }

    case "contacts": {
      const cards = asArray(payload).flatMap(readSharedContact)
      if (cards.length === 0) return typed("contacts", rawDetails(payload))
      return typed("contacts", { contacts: cards })
    }

    case "reaction": {
      const reaction = asRecord(payload)
      const targetMetaMessageId = asString(reaction?.message_id)
      if (!targetMetaMessageId) return typed("reaction", rawDetails(payload))
      return typed(
        "reaction",
        compact({
          // **La ausencia de `emoji` ES la señal de reacción retirada.** No hay
          // ningún flag: si el usuario quita su reacción llega otro webhook
          // igual pero sin la propiedad.
          emoji: asString(reaction?.emoji),
          targetMetaMessageId,
        })
      )
    }

    case "interactive": {
      const interactive = asRecord(payload)
      return typed("interactive", {
        // `list_reply` y `button_reply` son los dos únicos documentados, pero
        // las respuestas de Flows (`nfm_reply`) existen y no están en esa
        // página. Se guarda el discriminador como string libre en vez de
        // cerrarlo, y el payload entero detrás.
        interactiveType: asString(interactive?.type) ?? "unknown",
        payload: stripMediaUrls(payload) ?? null,
      })
    }

    case "button":
      // Un botón de respuesta rápida de una **plantilla**, que Meta manda como
      // tipo propio y no como `interactive.button_reply` (ése es el botón de un
      // mensaje interactivo que enviamos nosotros). No está en el catálogo de
      // `attachment_type` y tampoco merece estarlo: es la misma clase de hecho
      // —el usuario pulsó algo que le ofrecimos—, así que entra como
      // `interactive` con el discriminador `button` y el payload conservado.
      // Nótese que `button.payload` **es** la etiqueta del botón, no un
      // identificador nuestro: Meta documenta `payload` y `text` con el mismo
      // placeholder.
      return typed("interactive", {
        interactiveType: "button",
        payload: stripMediaUrls(payload) ?? null,
      })

    case "order":
    case "system":
      // Pedidos y eventos de sistema tienen tipo propio en el catálogo, pero
      // ningún detalle nuestro que los describa. Se conservan enteros en `raw`
      // en vez de aplanarlos a un texto legible: el texto sería una
      // interpretación nuestra irreversible, y el importe de un pedido o el
      // nuevo `wa_id` de un cambio de número se necesitan como datos, no como
      // frase.
      return typed(reported, rawDetails(payload))

    case "unsupported":
      // Encuestas, mensajes fijados, invitaciones a grupo y ediciones del
      // usuario llegan todos por aquí. Cloud API no sabe leerlos y nosotros
      // tampoco, pero el hecho de que existan sí importa: el `errors[]` que los
      // acompaña queda en el evento y distingue "tipo desconocido" (131051) del
      // primer mensaje a un número de Coexistence (131060).
      return unknownType(reported, payload, null)

    case HISTORY_MEDIA_PLACEHOLDER:
      // Sabemos que hubo binario y sabemos que no lo tenemos: `unavailable`, y
      // el llamador no encola nada. Si el segundo webhook con el ID llega —solo
      // para los últimos 14 días—, ese trae el tipo real (`image`, `audio`…) y
      // su propio `providerMediaId`.
      return unknownType(reported, payload, "unavailable")

    default:
      // **Ningún mensaje desconocido se pierde en silencio.** Meta añade tipos
      // sin cambiar de versión de API: descartarlos dejaría huecos mudos en la
      // conversación del tenant, imposibles de detectar y de recuperar después,
      // y convertirlos en texto los falsificaría. `rawType` guarda el string
      // literal que mandó Meta para que se pueda medir qué está llegando antes
      // de decidir si merece modelarse.
      return unknownType(reported, payload, null)
  }
}

function readMedia(
  type: MessageAttachmentType,
  payload: unknown
): InterpretedMessage {
  const media = asRecord(payload)
  const providerMediaId = asString(media?.id)

  return {
    // Audio y sticker no admiten pie de foto; imagen, vídeo y documento sí, y
    // solo llega si el usuario lo escribió (la tabla de Meta lo marca como no
    // opcional, pero es un error evidente de la doc). El pie de foto **es** el
    // texto del mensaje y no se duplica dentro del jsonb.
    text: asString(media?.caption),
    attachment: {
      type,
      title: null,
      details: compact({
        providerMediaId,
        mimeType: asString(media?.mime_type),
        sha256: asString(media?.sha256),
        filename: asString(media?.filename),
        // `true` = nota de voz (el usuario mantuvo pulsado el micro), `false` =
        // fichero de audio adjuntado. Meta documenta los dos valores
        // explícitos, así que la ausencia del campo no significa `false`:
        // significa que este payload no lo dice.
        voice: asBoolean(media?.voice),
        animated: asBoolean(media?.animated),
      }),
      providerMediaId,
      // Sin ID no hay descarga que pedir, y encolarla sería reintentar para
      // siempre algo que no existe.
      status: providerMediaId ? "pending" : "unavailable",
    },
  }
}

function typed(
  type: MessageAttachmentType,
  details: Record<string, unknown>
): InterpretedMessage {
  // Ninguno de estos tipos tiene binario detrás, así que `attachment_status`
  // queda null y no se encola nada.
  return {
    text: null,
    attachment: {
      type,
      title: null,
      details,
      providerMediaId: null,
      status: null,
    },
  }
}

function unknownType(
  reported: string,
  payload: unknown,
  status: "unavailable" | null
): InterpretedMessage {
  return {
    text: null,
    attachment: {
      type: "unknown",
      title: null,
      details: compact({
        rawType: reported || "unknown",
        ...rawDetails(payload),
      }),
      providerMediaId: null,
      status,
    },
  }
}

function rawDetails(payload: unknown): Record<string, unknown> {
  return compact({ raw: stripMediaUrls(payload) ?? null })
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
