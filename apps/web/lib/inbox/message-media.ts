// Semántica visual de un adjunto en la bitácora (CONTEXT.md, «Semantica
// visual de Inbox»): preview de imagen, video o audio cuando hay URL usable,
// y una fila compacta con tipo + identificador para todo lo demás. La regla
// vive fuera del .tsx a propósito: los componentes no corren bajo Vitest y
// esta función sí tiene que estar cubierta.

export type AttachmentDisplay =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "audio"; url: string }
  | { kind: "row"; label: string; url: string | null }

// Solo estos types tienen preview nativo en el navegador. `file` queda fuera
// a propósito: es un documento descargable y se pinta como fila con link.
const PREVIEW_KIND: Record<string, "image" | "video" | "audio"> = {
  image: "image",
  sticker: "image",
  video: "video",
  reel: "video",
  ig_reel: "video",
  audio: "audio",
}

/**
 * Decide qué se pinta para el adjunto de un mensaje. Solo mapea el adjunto:
 * si el mensaje además trae texto, eso lo resuelve la vista, no esta función.
 *
 * Resender NO proxifica ni valida la URL (nada de fetch/HEAD): si la firma
 * del CDN de Meta venció, la burbuja se rompe — es el costo asumido de no
 * hospedar los archivos.
 */
export function toAttachmentDisplay(
  input: {
    type: string
    url: string | null
    meta: Record<string, unknown> | null
  } | null
): AttachmentDisplay | null {
  if (!input) return null

  // «Usable» acá es solo forma: `https` no vacía. Sirve tanto para el preview
  // como para el link de la fila — un esquema raro no merece ni el <a>.
  const url = usableUrl(input.url)

  const previewKind = url ? PREVIEW_KIND[input.type] : undefined
  if (previewKind && url) {
    return { kind: previewKind, url }
  }

  return { kind: "row", label: rowLabel(input.type, input.meta), url }
}

/** `post · Mirá esta oferta`, `sticker · 369239263222822`, o el type a secas. */
function rowLabel(type: string, meta: Record<string, unknown> | null) {
  const identifier = bestIdentifier(meta)
  return identifier ? `${type} · ${identifier}` : type
}

// El mejor identificador disponible, en orden de utilidad para quien lee la
// bitácora: el título humano primero, después los ids que se citan en soporte.
function bestIdentifier(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  return (
    asText(meta.title) ??
    asText(meta.stickerId) ??
    asText(meta.postId) ??
    bookingId(meta.booking) ??
    asText(meta.rawType)
  )
}

function bookingId(booking: unknown): string | null {
  if (typeof booking !== "object" || booking === null) return null
  return asText((booking as Record<string, unknown>).bookingId)
}

// Meta manda ids como string o número según el campo; los dos sirven de label.
function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function usableUrl(url: string | null): string | null {
  return url && url.startsWith("https://") ? url : null
}
