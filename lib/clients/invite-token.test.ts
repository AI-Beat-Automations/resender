import { describe, expect, it } from "vitest"

import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  invitePath,
  isInviteToken,
} from "./invite-token"
import { normalizeClientName, normalizeInviteEmail } from "./client-name"

describe("token de invitación", () => {
  it("genera tokens con la forma que acepta el login", () => {
    const token = generateInviteToken()
    expect(isInviteToken(token)).toBe(true)
    expect(generateInviteToken()).not.toBe(token)
  })

  it("guarda solo un hash estable del token", () => {
    const token = generateInviteToken()
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashInviteToken(token)).toBe(hashInviteToken(token))
    expect(hashInviteToken(token)).not.toContain(token)
  })

  // Es lo que evita un open redirect desde `/login?invite=`.
  it("rechaza cualquier cosa que no tenga forma de token", () => {
    for (const value of [
      "",
      "https://evil.example",
      "/connections",
      "a".repeat(42),
      "a".repeat(44),
      `${"a".repeat(42)}/`,
      null,
      undefined,
      42,
    ]) {
      expect(isInviteToken(value), String(value)).toBe(false)
    }
  })

  it("pone el token en la query, nunca en el path", () => {
    const token = generateInviteToken()
    const url = new URL(invitePath(token), "https://resender.dev")
    expect(url.pathname).toBe("/invite")
    expect(url.searchParams.get("token")).toBe(token)
  })

  it("vence a los siete días", () => {
    const now = new Date("2026-09-13T00:00:00Z")
    expect(inviteExpiresAt(now).toISOString()).toBe("2026-09-20T00:00:00.000Z")
  })
})

describe("nombre de cliente y correo de invitación", () => {
  it("recorta y exige un nombre de hasta 80 caracteres", () => {
    expect(normalizeClientName("  Panadería Pedro ")).toEqual({
      ok: true,
      value: "Panadería Pedro",
    })
    expect(normalizeClientName("   ")).toEqual({
      ok: false,
      error: "name_required",
    })
    expect(normalizeClientName("ñ".repeat(81))).toEqual({
      ok: false,
      error: "name_too_long",
    })
    expect(normalizeClientName("ñ".repeat(80)).ok).toBe(true)
  })

  it("el correo es opcional y se normaliza en minúsculas", () => {
    expect(normalizeInviteEmail("")).toEqual({ ok: true, value: null })
    expect(normalizeInviteEmail(" Pedro@Example.com ")).toEqual({
      ok: true,
      value: "pedro@example.com",
    })
    expect(normalizeInviteEmail("no-es-un-correo")).toEqual({
      ok: false,
      error: "invalid_email",
    })
  })
})
