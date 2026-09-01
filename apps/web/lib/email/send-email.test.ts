import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sendTemplateEmail } from "./send-email"

const input = {
  to: "ada@example.com",
  subject: "Recupera tu contraseña de Resender",
  templateId: "tpl-1",
  variables: { HEADING: "Recupera tu contraseña", RESET_URL: "https://x/y" },
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test"
  process.env.EMAIL_FROM = "Resender <no-reply@resender.dev>"
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_FROM
})

describe("sendTemplateEmail", () => {
  it("manda `template` y NUNCA `html`, `text` ni `react`", async () => {
    // No es estilo: con `template` en el payload la API **rechaza** esos tres
    // y no envía nada. Un `text` "por las dudas" rompe el envío entero.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "e1" })))

    const result = await sendTemplateEmail(input)

    expect(result.ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body.template).toEqual({
      id: "tpl-1",
      variables: input.variables,
    })
    expect(body).not.toHaveProperty("html")
    expect(body).not.toHaveProperty("text")
    expect(body).not.toHaveProperty("react")
    // El asunto y el `reply_to` van en el payload, no en la plantilla: el
    // payload tiene precedencia y así el asunto sale del diccionario.
    expect(body.subject).toBe(input.subject)
    expect(body.reply_to).toBe("info@resender.dev")
    expect(body.from).toBe("Resender <no-reply@resender.dev>")
    expect(body.to).toEqual(["ada@example.com"])
  })

  it("sin RESEND_API_KEY devuelve not_configured sin lanzar ni llamar a nadie", async () => {
    // `next dev` y vitest corren sin secretos a propósito.
    delete process.env.RESEND_API_KEY
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const result = await sendTemplateEmail(input)

    expect(result).toMatchObject({ ok: false, reason: "not_configured" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sin EMAIL_FROM también devuelve not_configured", async () => {
    delete process.env.EMAIL_FROM
    const result = await sendTemplateEmail(input)
    expect(result).toMatchObject({ ok: false, reason: "not_configured" })
  })

  it("traduce un 4xx a ok:false con el motivo, sin lanzar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Domain not verified" }), {
        status: 422,
      })
    )

    const result = await sendTemplateEmail(input)

    expect(result).toMatchObject({
      ok: false,
      status: 422,
      reason: "http_error",
      error: "Domain not verified",
    })
  })

  it("traduce un fallo de red a ok:false, sin lanzar", async () => {
    // Que nunca lance es lo que hace visible el fallo: la librería envuelve
    // `sendResetPassword` en su propio try/catch y se traga la excepción.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timed out"))

    const result = await sendTemplateEmail(input)

    expect(result).toMatchObject({
      ok: false,
      reason: "network_error",
      error: "timed out",
    })
  })
})
