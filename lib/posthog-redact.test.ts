import { describe, expect, it } from "vitest"

import { redactEventUrls, redactUrl } from "./posthog-redact"

describe("redactUrl", () => {
  it("reescribe el token del enlace de recuperación", () => {
    expect(redactUrl("https://resender.dev/reset-password?token=abc123")).toBe(
      "https://resender.dev/reset-password?token=redacted"
    )
  })

  it("redacta también en la gemela en inglés y conserva el resto del query", () => {
    expect(
      redactUrl("https://resender.dev/en/reset-password?token=abc&ref=mail")
    ).toBe("https://resender.dev/en/reset-password?token=redacted&ref=mail")
  })

  it("devuelve idéntica una URL sin token", () => {
    const url = "https://resender.dev/login?passwordChanged=1"
    expect(redactUrl(url)).toBe(url)
  })

  it("devuelve la entrada tal cual si no parsea como URL, en vez de lanzar", () => {
    // `before_send` corre en el camino de cada evento: lanzar acá rompería la
    // analítica entera por una cadena rara.
    expect(redactUrl("no soy una url")).toBe("no soy una url")
    expect(redactUrl(undefined)).toBeUndefined()
    expect(redactUrl(42)).toBe(42)
  })
})

describe("redactEventUrls", () => {
  it("redacta las tres propiedades por las que la URL entra a PostHog", () => {
    const event = {
      properties: {
        $current_url: "https://resender.dev/reset-password?token=abc",
        $referrer: "https://resender.dev/reset-password?token=abc",
        $initial_current_url: "https://resender.dev/reset-password?token=abc",
        $pathname: "/reset-password",
      },
    }

    const out = redactEventUrls(event)!

    expect(out.properties.$current_url).toContain("token=redacted")
    expect(out.properties.$referrer).toContain("token=redacted")
    expect(out.properties.$initial_current_url).toContain("token=redacted")
    // Lo demás no se toca.
    expect(out.properties.$pathname).toBe("/reset-password")
  })

  it("tolera un evento nulo o sin properties", () => {
    expect(redactEventUrls(null)).toBeNull()
    expect(redactEventUrls({ properties: null })).toEqual({ properties: null })
  })
})
