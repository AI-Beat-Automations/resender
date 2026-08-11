import { afterEach, describe, expect, it, vi } from "vitest"

import {
  exceedsInstagramTextLimit,
  explainInstagramError,
  instagramTextByteLength,
  INSTAGRAM_TEXT_MAX_BYTES,
  sendInstagramTextMessage,
} from "./instagram-send"
import { explainMetaError } from "./meta-send"

const graphError = (code: number, subcode?: number) => ({
  error: {
    message: "algo salió mal",
    type: "OAuthException",
    code,
    ...(subcode === undefined ? {} : { error_subcode: subcode }),
  },
})

describe("límite de texto de Instagram", () => {
  // Instagram cuenta bytes UTF-8, no caracteres. En español la diferencia es
  // real: cada acento son 2 bytes y cada emoji 4.
  it("cuenta bytes UTF-8 y no caracteres", () => {
    expect(instagramTextByteLength("hola")).toBe(4)
    expect(instagramTextByteLength("ñ")).toBe(2)
    expect(instagramTextByteLength("🙂")).toBe(4)
  })

  it("deja pasar un texto justo en el límite", () => {
    expect(exceedsInstagramTextLimit("a".repeat(1000))).toBe(false)
    expect(exceedsInstagramTextLimit("a".repeat(1001))).toBe(true)
  })

  // 501 "ñ" son 501 caracteres y 1002 bytes: un control por `text.length`
  // lo dejaría pasar y lo rechazaría Instagram. Este es exactamente el texto en
  // español que motiva contar en bytes.
  it("rechaza un texto que cabe en caracteres pero no en bytes", () => {
    const text = "ñ".repeat(501)

    expect(text.length).toBeLessThan(INSTAGRAM_TEXT_MAX_BYTES)
    expect(instagramTextByteLength(text)).toBeGreaterThan(
      INSTAGRAM_TEXT_MAX_BYTES
    )
    expect(exceedsInstagramTextLimit(text)).toBe(true)
  })
})

describe("catálogo de errores de Instagram", () => {
  // El caso más frecuente de Instagram, y el que justifica tener catálogo
  // propio: el subcode de la ventana difiere del de Messenger (2018278), así
  // que con el catálogo compartido caía en la rama genérica de permisos y
  // mandaba al usuario a revisar algo que estaba bien.
  it("nombra la ventana de 24 horas con el subcode de Instagram", () => {
    const reason = explainInstagramError(graphError(10, 2534022))

    expect(reason).toContain("24-hour window is closed")
    expect(explainMetaError(graphError(10, 2534022))).not.toContain(
      "24-hour window is closed"
    )
  })

  it("distingue la ventana cerrada de un error de permisos", () => {
    expect(explainInstagramError(graphError(10))).toContain(
      "instagram_business_manage_messages"
    )
    expect(explainInstagramError(graphError(10))).not.toContain("24-hour")
  })

  // Decirle "reconectá la Página" a alguien que solo conectó Instagram lo manda
  // a buscar algo que no tiene.
  it("habla de la cuenta de Instagram y no de una Página al vencer el token", () => {
    const reason = explainInstagramError(graphError(190))

    expect(reason).toContain("Instagram access token")
    expect(reason).toContain("60 days")
    expect(reason).not.toContain("Page")
  })

  it("traduce indisponibilidad y rate limit", () => {
    expect(explainInstagramError(graphError(551))).toContain("isn't available")
    for (const code of [4, 17, 32, 613]) {
      expect(explainInstagramError(graphError(code))).toContain("rate limit")
    }
  })

  it("devuelve null ante un error que no está en el catálogo", () => {
    expect(explainInstagramError(graphError(999999))).toBeNull()
    expect(explainInstagramError({})).toBeNull()
    expect(explainInstagramError(null)).toBeNull()
  })
})

describe("envío de un DM de Instagram", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("pega a /me/messages con el token en el header y sin messaging_type", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message_id: "mid-1" }), { status: 200 })
      )

    const result = await sendInstagramTextMessage({
      accessToken: "ig-token",
      recipientId: "igsid-1",
      text: "hola",
    })

    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()

    const [url, init] = fetchMock.mock.calls[0]!
    // Sin id en el path: el token identifica a la cuenta que envía.
    expect(url).toBe("https://graph.instagram.com/v23.0/me/messages")
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer ig-token"
    )
    // El token no puede filtrarse a la query string, donde quedaría en logs.
    expect(String(url)).not.toContain("ig-token")

    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      recipient: { id: "igsid-1" },
      message: { text: "hola" },
    })
    // `messaging_type` es de Messenger; mandarlo es pedir un rechazo.
    expect(body).not.toHaveProperty("messaging_type")
  })

  it("devuelve el motivo traducido cuando la ventana está cerrada", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(graphError(10, 2534022)), { status: 400 })
    )

    const result = await sendInstagramTextMessage({
      accessToken: "ig-token",
      recipientId: "igsid-1",
      text: "hola",
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toBe("algo salió mal")
    expect(result.reason).toContain("24-hour window is closed")
  })

  it("convierte un fallo de red en un 502 con motivo accionable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"))

    const result = await sendInstagramTextMessage({
      accessToken: "ig-token",
      recipientId: "igsid-1",
      text: "hola",
    })

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      data: null,
      error: "timeout",
    })
    expect(result.reason).toContain("Retry shortly")
  })
})
