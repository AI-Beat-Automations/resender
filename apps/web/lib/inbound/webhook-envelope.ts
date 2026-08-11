// Describe la **forma** del sobre que mandó Meta: conteos y nombres de campo,
// nunca contenido.
//
// Es la respuesta al peor modo de falla que tuvo este proyecto: un parser que
// deja de reconocer el payload y devuelve cero eventos **sin un solo error**.
// No hay nada que investigar, porque no pasó nada.
//
// Con esto, una línea `webhook_receive` con `entryCount: 1, messagingCount: 1,
// count: 0` dice: el POST llegó, la firma estaba bien, el sobre traía un
// mensaje, y el parser no produjo nada. Eso alcanza para saber que hay que ir a
// leer el parser, que es todo lo que faltaba.
//
// Deliberadamente **no** vive adentro de los parsers. Son funciones puras con
// sus propios tests, y hacerlas loguear las volvería impuras y obligaría a
// mockear un logger en cada test que ya existe. Los conteos dan el mismo valor
// diagnóstico desde afuera.

export type WebhookEnvelopeShape = {
  entryCount: number
  // Eventos de mensajería: los DMs de Messenger y de Instagram.
  messagingCount: number
  // Cambios: los comentarios. Cuenta las dos formas —`entry[].changes[]` de
  // Facebook Login y el `entry` plano de Instagram Login—, porque para el
  // parser son la misma lista.
  changeCount: number
  // Los `field` distintos que vinieron, ordenados. Es lo que distingue
  // `comments` de `live_comments` sin tener que tocar el parser: si el sobre
  // dice `["live_comments"]` y salieron cero eventos, no hay bug.
  fields: string[]
}

type EnvelopeBody = {
  entry?: Array<{
    messaging?: unknown
    changes?: Array<{ field?: unknown }>
    field?: unknown
  }>
}

export function describeWebhookEnvelope(body: unknown): WebhookEnvelopeShape {
  const empty: WebhookEnvelopeShape = {
    entryCount: 0,
    messagingCount: 0,
    changeCount: 0,
    fields: [],
  }
  if (!body || typeof body !== "object") return empty

  const entries = (body as EnvelopeBody).entry
  if (!Array.isArray(entries)) return empty

  let messagingCount = 0
  let changeCount = 0
  const fields = new Set<string>()

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue

    if (Array.isArray(entry.messaging)) {
      messagingCount += entry.messaging.length
    }

    if (Array.isArray(entry.changes)) {
      changeCount += entry.changes.length
      for (const change of entry.changes) {
        if (change && typeof change.field === "string") fields.add(change.field)
      }
    }

    // La forma plana de Instagram Login: el evento viaja sobre el `entry`
    // mismo. Cuenta como un cambio más, igual que lo hace el parser.
    if (typeof entry.field === "string") {
      changeCount += 1
      fields.add(entry.field)
    }
  }

  return {
    entryCount: entries.length,
    messagingCount,
    changeCount,
    fields: [...fields].sort(),
  }
}
