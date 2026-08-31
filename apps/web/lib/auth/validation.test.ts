import { describe, expect, it } from "vitest"

import {
  normalizeEmail,
  validateAuthInput,
  validateNameInput,
  validatePasswordChangeInput,
  type NameInputError,
} from "./validation"

describe("auth input validation", () => {
  it("normalizes email before persistence and login", () => {
    expect(normalizeEmail("  USER@Example.COM ")).toBe("user@example.com")
  })

  it("requires a valid email and an 8 character password", () => {
    expect(validateAuthInput("bad", "12345678").ok).toBe(false)
    expect(validateAuthInput("user@example.com", "1234567").ok).toBe(false)
    expect(validateAuthInput("user@example.com", "12345678")).toEqual({
      ok: true,
      value: { email: "user@example.com", password: "12345678" },
    })
  })

  it("validates password change confirmation", () => {
    expect(validatePasswordChangeInput("1234567", "1234567")).toEqual({
      ok: false,
      error: "password_too_short",
    })
    expect(validatePasswordChangeInput("12345678", "different")).toEqual({
      ok: false,
      error: "passwords_do_not_match",
    })
    expect(validatePasswordChangeInput("12345678", "12345678")).toEqual({
      ok: true,
      value: { password: "12345678" },
    })
  })

  // El nombre lo exige Better Auth en el alta y se valida acá, no en
  // `auth-form.tsx`: vitest no ejecuta `.tsx`, así que una regla dentro del
  // componente sería una regla sin test.
  it("exige un nombre no vacío en el alta", () => {
    expect(validateNameInput("Ada Lovelace")).toEqual({
      ok: true,
      value: "Ada Lovelace",
    })
    expect(validateNameInput("  Ada  ")).toEqual({ ok: true, value: "Ada" })
  })

  it("devuelve el código name_required por cada entrada inválida", () => {
    for (const input of ["", "   ", "\t\n", undefined, null, 42, {}]) {
      expect(validateNameInput(input)).toEqual({
        ok: false,
        error: "name_required",
      })
    }
  })

  // Mismo `Record` sobre la unión que usan los server actions: un código nuevo
  // no compila hasta que alguien decida cómo se dice en los dos idiomas.
  it("no deja agregar un código de nombre sin decidir cómo se dice", () => {
    const NAME_KEY: Record<NameInputError, "nameRequired"> = {
      name_required: "nameRequired",
    }
    expect(NAME_KEY.name_required).toBe("nameRequired")
  })
})
