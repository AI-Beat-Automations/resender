import { describe, expect, it } from "vitest"

import { toAttachmentDisplay } from "./message-media"

const CDN = "https://cdn.fbsbx.com/v/archivo?oh=abc&oe=123"

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
    expect(toAttachmentDisplay({ type: "image", url: null, meta: null })).toEqual(
      { kind: "row", label: "image", url: null }
    )
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
