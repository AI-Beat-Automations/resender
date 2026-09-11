import { describe, expect, it } from "vitest"

import {
  MEDIA_LIMITS,
  buildMediaKey,
  isDownloadableKind,
  sanitizeFilename,
  validateMedia,
} from "./media-limits"

const MB = 1024 * 1024

describe("catálogo de media", () => {
  // Los cinco tipos que traen archivo. Si alguien agrega uno al catálogo de
  // `attachment_type` creyendo que trae bytes, este test lo obliga a decidir
  // acá también.
  it("cubre exactamente los cinco tipos descargables", () => {
    expect(Object.keys(MEDIA_LIMITS).sort()).toEqual([
      "audio",
      "file",
      "image",
      "sticker",
      "video",
    ])
  })

  it("no considera descargable lo que no es un archivo", () => {
    expect(isDownloadableKind("location")).toBe(false)
    expect(isDownloadableKind("reaction")).toBe(false)
    expect(isDownloadableKind("contacts")).toBe(false)
    expect(isDownloadableKind("unknown")).toBe(false)
    expect(isDownloadableKind(null)).toBe(false)
  })

  it("considera descargables los cinco que sí lo son", () => {
    for (const kind of ["image", "audio", "video", "file", "sticker"]) {
      expect(isDownloadableKind(kind)).toBe(true)
    }
  })
})

describe("validación de un medio entrante", () => {
  it("acepta lo que está en catálogo y entra en tamaño", () => {
    expect(
      validateMedia({
        kind: "image",
        mimeType: "image/jpeg",
        sizeBytes: 2 * MB,
      })
    ).toEqual({ ok: true })
  })

  // El caso real que rompe una comparación literal: Meta manda el codec pegado
  // al MIME en las notas de voz.
  it("acepta un MIME con parámetros, como el opus de una nota de voz", () => {
    expect(
      validateMedia({
        kind: "audio",
        mimeType: "audio/ogg; codecs=opus",
        sizeBytes: 20_000,
      })
    ).toEqual({ ok: true })
  })

  it("acepta el MIME sin importar mayúsculas ni espacios", () => {
    expect(
      validateMedia({
        kind: "image",
        mimeType: "  IMAGE/PNG  ",
        sizeBytes: 1000,
      })
    ).toEqual({ ok: true })
  })

  it("rechaza un MIME fuera del catálogo del tipo", () => {
    // gif no está en el catálogo de imagen de Cloud API, aunque «sea una
    // imagen».
    expect(
      validateMedia({ kind: "image", mimeType: "image/gif", sizeBytes: 1000 })
    ).toEqual({ ok: false, reason: "mime_not_allowed" })
  })

  // Cruzar los catálogos es un error real: un mp4 es válido como video y no
  // como imagen, y aceptarlo dejaría un archivo que la UI no sabe pintar.
  it("no acepta el MIME de otro tipo", () => {
    expect(
      validateMedia({ kind: "image", mimeType: "video/mp4", sizeBytes: 1000 })
    ).toEqual({ ok: false, reason: "mime_not_allowed" })
  })

  // Sin MIME no se puede servir el archivo con el `content-type` correcto, así
  // que se cierra en vez de aceptarlo «por las dudas».
  it("rechaza un MIME ausente", () => {
    expect(
      validateMedia({ kind: "image", mimeType: null, sizeBytes: 1000 })
    ).toEqual({ ok: false, reason: "mime_not_allowed" })
  })

  it("rechaza lo que pasa el tamaño de su tipo", () => {
    expect(
      validateMedia({
        kind: "image",
        mimeType: "image/jpeg",
        sizeBytes: 5 * MB + 1,
      })
    ).toEqual({ ok: false, reason: "too_large" })
  })

  it("acepta el borde exacto del tamaño", () => {
    expect(
      validateMedia({
        kind: "image",
        mimeType: "image/jpeg",
        sizeBytes: 5 * MB,
      })
    ).toEqual({ ok: true })
  })

  // Los límites son por tipo y son muy distintos: 5 MB una imagen, 100 MB un
  // documento. Un solo número para todos rechazaría PDFs perfectamente válidos.
  it("aplica el límite del tipo y no uno global", () => {
    expect(
      validateMedia({
        kind: "file",
        mimeType: "application/pdf",
        sizeBytes: 80 * MB,
      })
    ).toEqual({ ok: true })
    expect(
      validateMedia({
        kind: "image",
        mimeType: "image/jpeg",
        sizeBytes: 80 * MB,
      })
    ).toEqual({ ok: false, reason: "too_large" })
  })

  // Meta no siempre manda `file_size`. Rechazar por eso dejaría sin adjunto a
  // mensajes válidos; el corte real lo pone la escritura en R2.
  it("no rechaza cuando Meta no informó el tamaño", () => {
    expect(
      validateMedia({ kind: "image", mimeType: "image/png", sizeBytes: null })
    ).toEqual({ ok: true })
  })
})

describe("key de R2", () => {
  it("pone el tenant adelante, para que el borrado sea un solo prefijo", () => {
    const key = buildMediaKey({
      tenantId: "tenant-1",
      messageId: "msg-1",
      random: "abc",
    })
    expect(key).toBe("wa/tenant-1/msg-1/abc")
    expect(key.startsWith("wa/tenant-1/")).toBe(true)
  })

  // Sin el segmento aleatorio, conocer el id del mensaje sería conocer la key.
  it("no es adivinable desde el id del mensaje", () => {
    const first = buildMediaKey({ tenantId: "t", messageId: "m" })
    const second = buildMediaKey({ tenantId: "t", messageId: "m" })
    expect(first).not.toBe(second)
  })
})

describe("filename", () => {
  // El caso que importa: un separador de path dentro del nombre cambiaría dónde
  // termina el objeto si alguna vez alguien lo usara para construir la key.
  it("neutraliza separadores de path", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe(".._.._etc_passwd")
    expect(sanitizeFilename("a\\b")).toBe("a_b")
  })

  it("quita caracteres de control", () => {
    expect(sanitizeFilename("factura\u0000\u001f.pdf")).toBe("factura.pdf")
  })

  it("acota el largo", () => {
    expect(sanitizeFilename("a".repeat(500))?.length).toBe(200)
  })

  it("devuelve null cuando no queda nada utilizable", () => {
    expect(sanitizeFilename(null)).toBeNull()
    expect(sanitizeFilename("   ")).toBeNull()
    expect(sanitizeFilename("\u0000")).toBeNull()
  })
})
