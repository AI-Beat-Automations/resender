// Parser del webhook de **comentarios** de Instagram.
//
// Meta manda este evento en **dos formas distintas según el login del app**, y
// no es una variación cosmética:
//
// | | Instagram Login (el nuestro) | Facebook Login for Business |
// |---|---|---|
// | Ubicación | `entry[].field` + `entry[].value`, plano | `entry[].changes[]` |
// | Id del comentario | `value.id` | `value.comment_id` |
// | `parent_id` | no documentado | documentado |
//
// Se aceptan las dos. No es indecisión: la documentación describe las dos para
// el mismo campo, todavía no tenemos tráfico real contra el cual confirmar cuál
// llega, y asumir una sola significa que si Meta manda la otra el sistema queda
// mudo **sin un solo error en los logs** — el peor modo de falla posible para un
// webhook. Aceptar ambas cuesta unas líneas.

export type InboundCommentEvent = {
  igCommentId: string
  // Informado si el comentario es respuesta a otro; null si es raíz.
  parentIgCommentId: string | null
  // `entry.id`: el IG ID de la cuenta profesional dueña de la publicación.
  metaPageId: string
  mediaId: string
  mediaProductType: string | null
  // IGSID de quien comentó. Es la misma identidad que usa `conversations.contact_id`
  // para los DMs, y por eso alcanza para mandarle después una respuesta privada.
  fromIgId: string
  fromUsername: string | null
  text: string
  timestamp: Date
}

type CommentChange = {
  field?: unknown
  value?: {
    id?: unknown
    comment_id?: unknown
    parent_id?: unknown
    text?: unknown
    from?: { id?: unknown; username?: unknown }
    media?: { id?: unknown; media_product_type?: unknown }
  }
}

type InstagramCommentsBody = {
  entry?: Array<
    CommentChange & {
      id?: unknown
      time?: unknown
      changes?: CommentChange[]
    }
  >
}

export function extractInstagramComments(body: unknown): InboundCommentEvent[] {
  if (!body || typeof body !== "object") return []

  const entries = (body as InstagramCommentsBody).entry ?? []
  const events: InboundCommentEvent[] = []

  for (const entry of entries) {
    if (typeof entry.id !== "string") continue
    const timestamp = normalizeTimestamp(entry.time)

    // Las dos formas en una sola lista: el `entry` plano cuenta como un cambio
    // más, así que el resto del bucle no se entera de cuál llegó.
    const changes: CommentChange[] = [
      ...(Array.isArray(entry.changes) ? entry.changes : []),
      ...(entry.field !== undefined || entry.value !== undefined
        ? [{ field: entry.field, value: entry.value }]
        : []),
    ]

    for (const change of changes) {
      // `live_comments` es otro campo y queda fuera de alcance; sin este filtro
      // entraría por la misma puerta y se guardaría como si fuera un comentario
      // de una publicación.
      if (change.field !== "comments") continue

      const value = change.value
      if (!value) continue

      // `id` en Instagram Login, `comment_id` en Facebook Login.
      const igCommentId =
        typeof value.id === "string"
          ? value.id
          : typeof value.comment_id === "string"
            ? value.comment_id
            : null
      if (!igCommentId) continue

      const fromIgId = typeof value.from?.id === "string" ? value.from.id : null
      if (!fromIgId) continue

      // **El filtro anti-bucle.** La respuesta pública que publica Resender
      // vuelve a llegar como webhook `comments`. Sin descartarla, el sistema
      // responde su propia respuesta y así indefinidamente.
      //
      // A diferencia de los DMs no hay `is_echo`: la única señal es que quien
      // comentó sea la propia cuenta. La ingesta agrega una segunda
      // comprobación por @handle, porque de este filtro depende que el sistema
      // no entre en bucle y una sola señal es poca cosa para eso.
      if (fromIgId === entry.id) continue

      const mediaId =
        typeof value.media?.id === "string" ? value.media.id : null
      // `media_id` es `not null` en la tabla: sin él no hay publicación a la
      // cual colgar el comentario, y un placeholder rompería el índice por
      // publicación que ordena el hilo.
      if (!mediaId) continue

      const text = typeof value.text === "string" ? value.text.trim() : ""
      if (text.length === 0) continue

      events.push({
        igCommentId,
        parentIgCommentId:
          typeof value.parent_id === "string" ? value.parent_id : null,
        metaPageId: entry.id,
        mediaId,
        mediaProductType:
          typeof value.media?.media_product_type === "string"
            ? value.media.media_product_type
            : null,
        fromIgId,
        fromUsername:
          typeof value.from?.username === "string" ? value.from.username : null,
        text,
        timestamp,
      })
    }
  }

  return events
}

// `entry.time` es cuándo Meta mandó la notificación. Ante un valor inservible se
// usa la hora de recepción: perder el orden de un comentario es mucho menos
// grave que perderlo, y un `Invalid Date` rompería el insert.
function normalizeTimestamp(value: unknown) {
  if (typeof value !== "number") return new Date()
  // Meta manda segundos en `entry.time` de los webhooks de comentarios y
  // milisegundos en los de mensajes. Se distingue por magnitud: un valor de 10
  // dígitos interpretado como milisegundos cae en 1970.
  const millis = value < 1_000_000_000_000 ? value * 1000 : value
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? new Date() : date
}
