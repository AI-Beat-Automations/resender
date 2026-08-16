import { describe, expect, it } from "vitest"

import {
  CONNECTION_STATUS_BADGE,
  offersChannel,
  resolveConnectionStatus,
} from "./channel-display"

describe("channel offer", () => {
  it("offers Instagram to a tenant with the permission", () => {
    expect(offersChannel("instagram", true)).toBe(true)
  })

  it("hides Instagram from a tenant without the permission", () => {
    expect(offersChannel("instagram", false)).toBe(false)
  })

  // El permiso apaga un canal, no la cuenta: el Facebook del mismo tenant sigue
  // conectándose igual.
  it("keeps Messenger untouched either way", () => {
    expect(offersChannel("messenger", false)).toBe(true)
    expect(offersChannel("messenger", true)).toBe(true)
  })
})

describe("connected account status", () => {
  it("shows an Instagram account as active while the permission holds", () => {
    expect(
      resolveConnectionStatus({
        channel: "instagram",
        status: "active",
        instagramAccess: true,
      })
    ).toBe("active")
  })

  // El caso de revocación: la cuenta quedó conectada de antes y hoy no recibe
  // ni envía nada, así que la tarjeta lo dice en vez de mentir con «activa».
  it("shows a revoked Instagram account as no-access", () => {
    expect(
      resolveConnectionStatus({
        channel: "instagram",
        status: "active",
        instagramAccess: false,
      })
    ).toBe("no-access")
  })

  it("leaves Messenger pages out of the Instagram permission", () => {
    expect(
      resolveConnectionStatus({
        channel: "messenger",
        status: "active",
        instagramAccess: false,
      })
    ).toBe("active")
  })

  it("keeps a disconnected account disconnected, with or without permission", () => {
    expect(
      resolveConnectionStatus({
        channel: "instagram",
        status: "disconnected",
        instagramAccess: false,
      })
    ).toBe("disconnected")
    expect(
      resolveConnectionStatus({
        channel: "instagram",
        status: "disconnected",
        instagramAccess: true,
      })
    ).toBe("disconnected")
  })
})

describe("status badge", () => {
  it("labels the three states and keeps the red for the token", () => {
    expect(CONNECTION_STATUS_BADGE.active).toEqual({
      label: "activa",
      variant: "success",
    })
    expect(CONNECTION_STATUS_BADGE["no-access"]).toEqual({
      label: "sin acceso",
      variant: "warning",
    })
    expect(CONNECTION_STATUS_BADGE.disconnected).toEqual({
      label: "desconectada",
      variant: "ghost",
    })
  })
})
