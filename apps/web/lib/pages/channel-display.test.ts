import { describe, expect, it } from "vitest"

import type { ChannelAccess } from "@/lib/auth/channel-access"

import {
  CONNECTION_STATUS_BADGE,
  offersChannel,
  resolveConnectionStatus,
} from "./channel-display"

// Messenger nunca se cierra: no tiene bandera. Los otros dos se abren de a uno
// en los tests para que quede escrito que son permisos independientes.
function access(overrides: Partial<ChannelAccess> = {}): ChannelAccess {
  return { messenger: true, instagram: false, whatsapp: false, ...overrides }
}

describe("channel offer", () => {
  it("offers Instagram to a tenant with the permission", () => {
    expect(offersChannel("instagram", access({ instagram: true }))).toBe(true)
  })

  it("hides Instagram from a tenant without the permission", () => {
    expect(offersChannel("instagram", access())).toBe(false)
  })

  it("offers WhatsApp to a tenant with the permission", () => {
    expect(offersChannel("whatsapp", access({ whatsapp: true }))).toBe(true)
  })

  it("hides WhatsApp from a tenant without the permission", () => {
    expect(offersChannel("whatsapp", access())).toBe(false)
  })

  // Los dos permisos son de Meta pero se conceden por separado: tener Instagram
  // no ofrece WhatsApp, y al revés tampoco.
  it("does not let one permission open the other channel", () => {
    expect(offersChannel("whatsapp", access({ instagram: true }))).toBe(false)
    expect(offersChannel("instagram", access({ whatsapp: true }))).toBe(false)
  })

  // El permiso apaga un canal, no la cuenta: el Facebook del mismo tenant sigue
  // conectándose igual.
  it("keeps Messenger untouched either way", () => {
    expect(offersChannel("messenger", access())).toBe(true)
    expect(
      offersChannel("messenger", access({ instagram: true, whatsapp: true }))
    ).toBe(true)
  })
})

describe("connected account status", () => {
  it("shows an Instagram account as active while the permission holds", () => {
    expect(
      resolveConnectionStatus({
        channel: "instagram",
        status: "active",
        access: access({ instagram: true }),
      })
    ).toBe("active")
  })

  it("shows a WhatsApp number as active while the permission holds", () => {
    expect(
      resolveConnectionStatus({
        channel: "whatsapp",
        status: "active",
        access: access({ whatsapp: true }),
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
        access: access(),
      })
    ).toBe("no-access")
  })

  it("shows a revoked WhatsApp number as no-access", () => {
    expect(
      resolveConnectionStatus({
        channel: "whatsapp",
        status: "active",
        access: access(),
      })
    ).toBe("no-access")
  })

  it("leaves Messenger pages out of the channel permissions", () => {
    expect(
      resolveConnectionStatus({
        channel: "messenger",
        status: "active",
        access: access(),
      })
    ).toBe("active")
  })

  it("keeps a disconnected account disconnected, with or without permission", () => {
    expect(
      resolveConnectionStatus({
        channel: "instagram",
        status: "disconnected",
        access: access(),
      })
    ).toBe("disconnected")
    expect(
      resolveConnectionStatus({
        channel: "whatsapp",
        status: "disconnected",
        access: access({ whatsapp: true }),
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
