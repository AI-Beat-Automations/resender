import { describe, expect, it } from "vitest"

import {
  FORWARDING_PAUSE_SKIP_REASON,
  isForwardingPaused,
  resolveForwardingPause,
} from "./forwarding-pause"

const AT = new Date("2026-09-14T10:00:00Z")

describe("resolveForwardingPause", () => {
  it("reenvía cuando ni la conexión ni la conversación están pausadas", () => {
    expect(
      resolveForwardingPause({
        connectionPausedAt: null,
        conversationPausedAt: null,
      })
    ).toBeNull()
  })

  it("la conexión pausada corta el reenvío aunque la conversación esté activa", () => {
    expect(
      resolveForwardingPause({
        connectionPausedAt: AT,
        conversationPausedAt: null,
      })
    ).toBe("connection_paused")
  })

  it("la conversación pausada corta el reenvío con la conexión activa", () => {
    expect(
      resolveForwardingPause({
        connectionPausedAt: null,
        conversationPausedAt: AT,
      })
    ).toBe("conversation_paused")
  })

  // La conexión es la llave maestra: es el motivo que hay que levantar
  // primero, así que es el que se registra.
  it("con las dos pausadas gana el motivo de la conexión", () => {
    expect(
      resolveForwardingPause({
        connectionPausedAt: AT,
        conversationPausedAt: AT,
      })
    ).toBe("connection_paused")
  })

  it("cada motivo tiene su texto para la bitácora", () => {
    expect(FORWARDING_PAUSE_SKIP_REASON.connection_paused).toMatch(/connection/)
    expect(FORWARDING_PAUSE_SKIP_REASON.conversation_paused).toMatch(
      /conversation/
    )
  })
})

describe("isForwardingPaused", () => {
  it("null y undefined son «activa»; una fecha es «pausada»", () => {
    expect(isForwardingPaused(null)).toBe(false)
    expect(isForwardingPaused(undefined)).toBe(false)
    expect(isForwardingPaused(AT)).toBe(true)
  })
})
