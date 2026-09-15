import type { MessageAttachmentType } from "./message-enums"

// Tipos, tamaños y MIME que Cloud API acepta, verificados contra la
// documentación de Meta el **24 de agosto de 2026**.
//
// Meta cambia estos números. Si una implementación no coincide con la doc, gana
// la doc, y hay que actualizar esta tabla **con la fecha**. Vive en un módulo
// propio y cubierto por tests, y no repartido por los parsers, porque es lo que
// decide si un archivo se guarda o se rechaza: repetido en tres lugares, se
// arregla en uno y sigue mal en dos.
//
// El límite se aplica a lo que **entra**. Lo saliente lo hospeda el cliente y lo
// valida Meta al descargarlo, así que acá no aparece.

export type MediaKind = Extract<
  MessageAttachmentType,
  "image" | "audio" | "video" | "file" | "sticker"
>

export type MediaLimit = {
  maxBytes: number
  mimeTypes: readonly string[]
}

const KB = 1024
const MB = 1024 * 1024

export const MEDIA_LIMITS: Record<MediaKind, MediaLimit> = {
  image: {
    maxBytes: 5 * MB,
    mimeTypes: ["image/jpeg", "image/png"],
  },
  video: {
    maxBytes: 16 * MB,
    mimeTypes: ["video/mp4", "video/3gpp"],
  },
  audio: {
    maxBytes: 16 * MB,
    mimeTypes: [
      "audio/aac",
      "audio/amr",
      "audio/mpeg",
      "audio/mp4",
      "audio/ogg",
    ],
  },
  // `file` es el `document` de WhatsApp: mismo concepto, y el catálogo de
  // `attachment_type` ya tenía el primer nombre.
  file: {
    maxBytes: 100 * MB,
    mimeTypes: [
      "text/plain",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },
  // El sticker animado admite 500 KB y el estático 100 KB. Se toma el mayor:
  // por el MIME no se puede distinguir cuál es, y rechazar un animado válido
  // por creerlo estático sería peor que aceptar un estático de más.
  sticker: {
    maxBytes: 500 * KB,
    mimeTypes: ["image/webp"],
  },
}

export function isDownloadableKind(type: string | null): type is MediaKind {
  return type !== null && type in MEDIA_LIMITS
}

export type MediaValidation =
  | { ok: true }
  | { ok: false; reason: "mime_not_allowed" | "too_large" }

/**
 * Valida lo que Meta dice que nos va a mandar, **antes** de escribirlo en R2.
 *
 * El MIME se compara sólo con la parte del tipo: Meta manda `audio/ogg;
 * codecs=opus` en las notas de voz, y una comparación literal lo rechazaría.
 *
 * Un MIME ausente no se acepta «por las dudas»: sin MIME no se puede servir el
 * archivo con el `content-type` correcto ni saber si entra en el catálogo, así
 * que se trata como no permitido.
 */
export function validateMedia(input: {
  kind: MediaKind
  mimeType: string | null
  sizeBytes: number | null
}): MediaValidation {
  const limit = MEDIA_LIMITS[input.kind]

  const declared = input.mimeType?.split(";")[0]?.trim().toLowerCase() ?? null
  if (!declared || !limit.mimeTypes.includes(declared)) {
    return { ok: false, reason: "mime_not_allowed" }
  }

  // Un tamaño ausente no se rechaza: Meta no siempre manda `file_size`, y el
  // corte real lo pone el `maxBytes` al escribir. Rechazar acá dejaría sin
  // adjunto a mensajes perfectamente válidos.
  if (input.sizeBytes !== null && input.sizeBytes > limit.maxBytes) {
    return { ok: false, reason: "too_large" }
  }

  return { ok: true }
}

/**
 * La key en R2. El tenant va **adelante** para que el borrado de cuenta sea un
 * solo prefijo (`wa/{tenantId}/`), y el segmento aleatorio para que la key no
 * se pueda adivinar desde el id del mensaje.
 *
 * El filename del cliente **nunca** entra en el path: es texto que eligió un
 * tercero y ahí adentro un `../` o un `/` cambian dónde termina el objeto. Va
 * en la metadata, que es donde no puede hacer daño.
 */
export function buildMediaKey(input: {
  tenantId: string
  messageId: string
  random?: string
}): string {
  const random = input.random ?? crypto.randomUUID()
  return `wa/${input.tenantId}/${input.messageId}/${random}`
}

/**
 * Sanea el filename para devolvérselo al cliente en la descarga. No se usa para
 * la key —ahí no entra nunca—, sino para el `content-disposition` y la
 * metadata: separadores de path y caracteres de control fuera, y un largo
 * acotado para que no sea un vector de cabecera gigante.
 */
export function sanitizeFilename(filename: string | null): string | null {
  if (!filename) return null
  const trimmed = filename
    .replace(/[\\/]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200)
  return trimmed.length > 0 ? trimmed : null
}
