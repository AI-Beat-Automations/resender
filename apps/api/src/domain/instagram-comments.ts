export type InboundInstagramComment = {
  providerCommentId: string
  // Informado si el comentario responde a otro; null si es raíz.
  parentCommentId: string | null
  // `entry.id`: el IG ID de la cuenta profesional dueña de la publicación.
  providerAccountId: string
  mediaId: string
  mediaProductType: string | null
  // IGSID de quien comentó. Es la misma identidad que usa `contact_id` para los
  // DMs, y por eso alcanza para mandarle después una respuesta privada.
  fromProviderUserId: string
  fromUsername: string | null
  text: string
  createdAt: Date
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

// Parser del webhook de **comentarios**. Meta lo manda en dos formas distintas
// según el login del app, y no es una variación cosmética:
//
// | | Instagram Login (el nuestro) | Facebook Login for Business |
// |---|---|---|
// | Ubicación | `entry[].field` + `entry[].value`, plano | `entry[].changes[]` |
// | Id del comentario | `value.id` | `value.comment_id` |
// | `parent_id` | no documentado | documentado |
//
// Se aceptan las dos. La documentación describe ambas para el mismo campo y
// asumir una sola significa que, si llega la otra, el sistema queda **mudo sin
// un solo error en los logs** — el peor modo de falla posible para un webhook,
// porque no hay nada que investigar.
export function extractInstagramComments(
  value: unknown
): InboundInstagramComment[] {
  if (!value || typeof value !== "object") return []

  const events: InboundInstagramComment[] = []

  for (const entry of (value as InstagramCommentsBody).entry ?? []) {
    if (typeof entry.id !== "string") continue
    const createdAt = normalizeTimestamp(entry.time)

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
      // entraría por la misma puerta y se guardaría como si colgara de una
      // publicación.
      if (change.field !== "comments") continue
      const value = change.value
      if (!value) continue

      // `id` en Instagram Login, `comment_id` en Facebook Login.
      const providerCommentId =
        typeof value.id === "string"
          ? value.id
          : typeof value.comment_id === "string"
            ? value.comment_id
            : null
      if (!providerCommentId) continue

      const fromProviderUserId =
        typeof value.from?.id === "string" ? value.from.id : null
      if (!fromProviderUserId) continue

      // **Primera señal anti-bucle.** La respuesta pública que publica Resender
      // vuelve a llegar como webhook `comments`; sin filtrarla, el sistema
      // responde su propia respuesta indefinidamente. A diferencia de los DMs no
      // hay `is_echo`: la única señal estructural es que quien comentó sea la
      // propia cuenta.
      //
      // La ingesta agrega dos comprobaciones más —el @handle y si el id es de un
      // comentario que publicamos nosotros—, porque de este filtro depende que
      // el sistema no entre en bucle y una sola señal es poca cosa para eso.
      if (fromProviderUserId === entry.id) continue

      // `media_id` es `not null` en la tabla: sin él no hay publicación a la
      // cual colgar el comentario, y un placeholder rompería el índice por
      // publicación que ordena el hilo.
      const mediaId =
        typeof value.media?.id === "string" ? value.media.id : null
      if (!mediaId) continue

      const text = typeof value.text === "string" ? value.text.trim() : ""
      if (!text) continue

      events.push({
        providerCommentId,
        parentCommentId:
          typeof value.parent_id === "string" ? value.parent_id : null,
        providerAccountId: entry.id,
        mediaId,
        mediaProductType:
          typeof value.media?.media_product_type === "string"
            ? value.media.media_product_type
            : null,
        fromProviderUserId,
        fromUsername:
          typeof value.from?.username === "string" ? value.from.username : null,
        text,
        createdAt,
      })
    }
  }

  return events
}

function normalizeTimestamp(value: unknown): Date {
  if (typeof value !== "number") return new Date()
  // Meta manda **segundos** en el `entry.time` de los webhooks de comentarios y
  // **milisegundos** en los de mensajes. Se distingue por magnitud: un valor de
  // 10 dígitos leído como milisegundos cae en 1970, lo que fecharía todos los
  // comentarios en el pasado y rompería el orden del hilo.
  const millis = value < 1_000_000_000_000 ? value * 1000 : value
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? new Date() : date
}
