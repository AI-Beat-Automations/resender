import { describe, expect, it } from "vitest"

import { classifyOAuthError, classifyVerificationError } from "./oauth-errors"

// Los trece de `better-auth/dist/oauth2/errors.mjs`
// (`OAUTH_CALLBACK_ERROR_CODES`). `account_not_linked` no está entre ellos:
// lo emite `link-account.mjs` aparte y el callback lo convierte en snake_case.
const OTHER_OAUTH_CODES = [
  "no_code",
  "oauth_provider_not_found",
  "issuer_missing",
  "issuer_mismatch",
  "invalid_code",
  "nonce_binding_missing",
  "unable_to_get_user_info",
  "no_callback_url",
  "unable_to_link_account",
  "email_does_not_match",
  "account_already_linked_to_different_user",
  "email_not_found",
  "email_not_verified",
]

describe("classifyOAuthError", () => {
  it("no muestra nada sin código", () => {
    expect(classifyOAuthError(undefined)).toBeNull()
    expect(classifyOAuthError(null)).toBeNull()
    expect(classifyOAuthError("")).toBeNull()
    expect(classifyOAuthError("   ")).toBeNull()
    expect(classifyOAuthError([])).toBeNull()
  })

  it("account_not_linked es el único con salida propia", () => {
    expect(classifyOAuthError("account_not_linked")).toBe("account_not_linked")
  })

  it("normaliza mayúsculas y espacios del código", () => {
    expect(classifyOAuthError(" ACCOUNT_NOT_LINKED ")).toBe(
      "account_not_linked"
    )
  })

  it("los otros trece códigos de la librería caen en el genérico", () => {
    expect(OTHER_OAUTH_CODES).toHaveLength(13)
    for (const code of OTHER_OAUTH_CODES) {
      expect(classifyOAuthError(code), code).toBe("generic")
    }
  })

  it("un código desconocido también da el genérico y no rompe", () => {
    expect(classifyOAuthError("algo_que_no_existe")).toBe("generic")
  })

  it("con varios ?error= toma el primero", () => {
    expect(classifyOAuthError(["account_not_linked", "no_code"])).toBe(
      "account_not_linked"
    )
    expect(classifyOAuthError(["no_code", "account_not_linked"])).toBe(
      "generic"
    )
  })
})

describe("classifyVerificationError", () => {
  it("reconoce el vencido y el inválido tal como los manda 1.7.2, en mayúsculas", () => {
    expect(classifyVerificationError("TOKEN_EXPIRED")).toBe("link_expired")
    expect(classifyVerificationError("INVALID_TOKEN")).toBe("link_expired")
  })

  it("acepta también los mismos códigos en minúsculas", () => {
    expect(classifyVerificationError("token_expired")).toBe("link_expired")
    expect(classifyVerificationError("invalid_token")).toBe("link_expired")
  })

  it("ignora cualquier otro valor, incluido ausente", () => {
    expect(classifyVerificationError(undefined)).toBeNull()
    expect(classifyVerificationError(null)).toBeNull()
    expect(classifyVerificationError("")).toBeNull()
    expect(classifyVerificationError("USER_NOT_FOUND")).toBeNull()
    expect(classifyVerificationError("INVALID_USER")).toBeNull()
    expect(classifyVerificationError("account_not_linked")).toBeNull()
  })
})
