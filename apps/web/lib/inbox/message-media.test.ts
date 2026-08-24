import { describe, expect, it } from "vitest"

import {
  ATTACHMENT_STATUS_COPY,
  toAttachmentDisplay,
  whatsappMediaUrl,
} from "./message-media"

const CDN = "https://cdn.fbsbx.com/v/archivo?oh=abc&oe=123"
const MEDIA_ROUTE = "/api/meta/whatsapp/media/9f1c-msg"

describe("toAttachmentDisplay", () => {
  it("devuelve null cuando el mensaje no trae adjunto", () => {
    expect(toAttachmentDisplay(null)).toBeNull()
  })

  it("mapea imagen y sticker con URL a preview de imagen", () => {
    expect(
      toAttachmentDisplay({ type: "image", url: CDN, meta: null })
    ).toEqual({ kind: "image", url: CDN })
    expect(
      toAttachmentDisplay({
        type: "sticker",
        url: CDN,
        meta: { stickerId: 369239263222822 },
      })
    ).toEqual({ kind: "image", url: CDN })
  })

  it("mapea video, reel e ig_reel a preview de video", () => {
    for (const type of ["video", "reel", "ig_reel"]) {
      expect(toAttachmentDisplay({ type, url: CDN, meta: null })).toEqual({
        kind: "video",
        url: CDN,
      })
    }
  })

  it("mapea audio a preview de audio", () => {
    expect(
      toAttachmentDisplay({ type: "audio", url: CDN, meta: null })
    ).toEqual({ kind: "audio", url: CDN })
  })

  it("pinta `file` como fila con link, no como preview", () => {
    // Un documento descargable no tiene preview nativo: fila con el link crudo.
    expect(
      toAttachmentDisplay({
        type: "file",
        url: CDN,
        meta: { title: "menu.pdf" },
      })
    ).toEqual({ kind: "row", label: "file · menu.pdf", url: CDN })
  })

  it("etiqueta la fila con el título cuando lo hay", () => {
    expect(
      toAttachmentDisplay({
        type: "post",
        url: null,
        meta: { title: "Mirá esta oferta", postId: "17900001" },
      })
    ).toEqual({ kind: "row", label: "post · Mirá esta oferta", url: null })
  })

  it("cae a los ids cuando no hay título", () => {
    expect(
      toAttachmentDisplay({
        type: "appointment_booking",
        url: null,
        meta: { booking: { bookingId: "bk-778" } },
      })
    ).toEqual({ kind: "row", label: "appointment_booking · bk-778", url: null })
    expect(
      toAttachmentDisplay({
        type: "unknown",
        url: null,
        meta: { rawType: "gif" },
      })
    ).toEqual({ kind: "row", label: "unknown · gif", url: null })
  })

  it("usa el type a secas cuando el meta no aporta nada", () => {
    expect(
      toAttachmentDisplay({ type: "fallback", url: null, meta: {} })
    ).toEqual({ kind: "row", label: "fallback", url: null })
    expect(
      toAttachmentDisplay({ type: "template", url: null, meta: null })
    ).toEqual({ kind: "row", label: "template", url: null })
  })

  it("degrada a fila la imagen sin URL usable", () => {
    // Sin URL no hay nada que pintar: queda la fila con el tipo, sin link.
    expect(
      toAttachmentDisplay({ type: "image", url: null, meta: null })
    ).toEqual({ kind: "row", label: "image", url: null })
    expect(
      toAttachmentDisplay({ type: "image", url: "http://inseguro", meta: null })
    ).toEqual({ kind: "row", label: "image", url: null })
  })

  it("solo mapea el adjunto: el texto del mensaje no es asunto suyo", () => {
    // La función no recibe el texto a propósito — texto + adjunto los compone
    // la vista; acá entra el adjunto solo y sale su representación.
    expect(
      toAttachmentDisplay({ type: "image", url: CDN, meta: { title: "foto" } })
    ).toEqual({ kind: "image", url: CDN })
  })
})

describe("adjuntos de WhatsApp", () => {
  it("pinta como fila los seis types que suma la 0017", () => {
    // Ninguno es un binario: son cargas estructuradas, no archivos. `reaction`
    // ni siquiera llega acá — se agrupa sobre el mensaje al que apunta —, pero
    // si llegara tampoco tiene preview.
    for (const type of [
      "location",
      "contacts",
      "reaction",
      "interactive",
      "order",
      "system",
    ]) {
      expect(
        toAttachmentDisplay({ type, url: MEDIA_ROUTE, meta: null })
      ).toEqual({ kind: "row", label: type, url: MEDIA_ROUTE })
    }
  })

  it("etiqueta la ubicación por su nombre o su dirección", () => {
    expect(
      toAttachmentDisplay({
        type: "location",
        url: null,
        meta: { name: "Café Rioja" },
      })
    ).toEqual({ kind: "row", label: "location · Café Rioja", url: null })
    expect(
      toAttachmentDisplay({
        type: "location",
        url: null,
        meta: { address: "Gorriti 4800" },
      })
    ).toEqual({ kind: "row", label: "location · Gorriti 4800", url: null })
  })

  it("acepta la ruta propia como URL de preview, no solo el CDN de Meta", () => {
    // La URL firmada de Cloud API dura cinco minutos y exige el token: un
    // <img src> apuntando ahí se rompe siempre. La copia que dura es la de R2.
    expect(
      toAttachmentDisplay({
        type: "image",
        url: MEDIA_ROUTE,
        meta: null,
        status: "available",
      })
    ).toEqual({ kind: "image", url: MEDIA_ROUTE })
  })
})

describe("whatsappMediaUrl", () => {
  it("apunta a la ruta propia y nunca al CDN de Meta", () => {
    expect(whatsappMediaUrl({ messageId: "msg-1", status: "available" })).toBe(
      "/api/meta/whatsapp/media/msg-1"
    )
    expect(whatsappMediaUrl({ messageId: "msg-1", status: "pending" })).toBe(
      "/api/meta/whatsapp/media/msg-1"
    )
    expect(whatsappMediaUrl({ messageId: "msg-1", status: "failed" })).toBe(
      "/api/meta/whatsapp/media/msg-1"
    )
  })

  it("no da link cuando el objeto no existe ni puede existir", () => {
    // `deleted` venció a los 180 días y `unavailable` nunca estuvo: un link
    // acá solo sirve para que el usuario se coma un 404.
    expect(
      whatsappMediaUrl({ messageId: "msg-1", status: "deleted" })
    ).toBeNull()
    expect(
      whatsappMediaUrl({ messageId: "msg-1", status: "unavailable" })
    ).toBeNull()
  })
})

describe("ATTACHMENT_STATUS_COPY", () => {
  it("le da copy propio a los cinco estados", () => {
    // Requisito de producto: colapsar `failed` con `unavailable` deja a
    // soporte sin distinguir un bug nuestro de un límite de Meta.
    expect(ATTACHMENT_STATUS_COPY).toEqual({
      pending: "descargando…",
      available: "preview / descarga",
      failed: "no se pudo descargar",
      deleted: "archivo expirado",
      unavailable: "WhatsApp no conserva archivos de más de 14 días",
    })
    expect(new Set(Object.values(ATTACHMENT_STATUS_COPY)).size).toBe(5)
  })

  it("el estado gana sobre la URL: nada de previews rotos", () => {
    for (const status of [
      "pending",
      "failed",
      "deleted",
      "unavailable",
    ] as const) {
      expect(
        toAttachmentDisplay({
          type: "image",
          url: MEDIA_ROUTE,
          meta: { title: "foto.jpg" },
          status,
        })
      ).toEqual({
        kind: "row",
        label: `image · ${ATTACHMENT_STATUS_COPY[status]}`,
        url: null,
      })
    }
  })

  it("no toca a Messenger ni a Instagram, que no informan estado", () => {
    expect(
      toAttachmentDisplay({ type: "image", url: CDN, meta: null, status: null })
    ).toEqual({ kind: "image", url: CDN })
  })
})
