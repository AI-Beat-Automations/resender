import { describe, expect, it } from "vitest"

import { classifyUnlinkError, summarizeAccounts } from "./sign-in-methods"

describe("summarizeAccounts", () => {
  it("solo contraseña: hay password, Google no está y no hay nada que quitar", () => {
    expect(summarizeAccounts([{ id: "a1", providerId: "credential" }])).toEqual(
      {
        password: true,
        google: { linked: false },
        canRemoveGoogle: false,
        total: 1,
      }
    )
  })

  // El id que se expone es el de la **fila**, que es lo que `unlinkAccount`
  // pide; no el `sub` de Google.
  it("las dos: Google se puede quitar porque queda la contraseña", () => {
    expect(
      summarizeAccounts([
        { id: "a1", providerId: "credential" },
        { id: "a2", providerId: "google" },
      ])
    ).toEqual({
      password: true,
      google: { linked: true, accountId: "a2" },
      canRemoveGoogle: true,
      total: 2,
    })
  })

  // **La regla que el panel existe para respetar**: la librería rechaza
  // quitar la última credencial, así que no se ofrece.
  it("solo Google: es la única forma de entrar y no se ofrece quitarla", () => {
    expect(summarizeAccounts([{ id: "a2", providerId: "google" }])).toEqual({
      password: false,
      google: { linked: true, accountId: "a2" },
      canRemoveGoogle: false,
      total: 1,
    })
  })

  it("sin filas no revienta: nada configurado", () => {
    expect(summarizeAccounts([])).toEqual({
      password: false,
      google: { linked: false },
      canRemoveGoogle: false,
      total: 0,
    })
  })
})

describe("classifyUnlinkError", () => {
  it("traduce los tres códigos que la librería puede lanzar", () => {
    expect(classifyUnlinkError("FAILED_TO_UNLINK_LAST_ACCOUNT")).toBe(
      "last_credential"
    )
    expect(classifyUnlinkError("SESSION_NOT_FRESH")).toBe("session_not_fresh")
    expect(classifyUnlinkError("ACCOUNT_NOT_FOUND")).toBe("account_not_found")
  })

  it("cualquier otra cosa es desconocido, sin romper", () => {
    expect(classifyUnlinkError("SOMETHING_ELSE")).toBe("unknown")
    expect(classifyUnlinkError(undefined)).toBe("unknown")
    expect(classifyUnlinkError(42)).toBe("unknown")
  })
})
