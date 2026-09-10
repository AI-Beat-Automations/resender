import { createHmac } from "crypto"

import { beforeEach, describe, expect, it } from "vitest"

import { encryptSecret } from "@/lib/crypto/encryption"

import {
  generateWebhookSigningSecret,
  signaturePayload,
  signedWebhookHeaders,
  signWebhookBody,
  verifyWebhookSignature,
} from "./webhook-signing"

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64)
})

describe("generateWebhookSigningSecret", () => {
  it("usa un prefijo legible, como las API keys del producto", () => {
    expect(generateWebhookSigningSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
  })

  it("no repite", () => {
    const secrets = new Set(
      Array.from({ length: 50 }, () => generateWebhookSigningSecret())
    )
    expect(secrets.size).toBe(50)
  })
})

describe("signaturePayload", () => {
  // Lo que se firma es la mitad del esquema que hay que documentar bien: si el
  // cliente arma otra cadena, su verificación falla siempre y no sabe por qué.
  it("firma eventId, timestamp y cuerpo, en ese orden y con puntos", () => {
    expect(
      signaturePayload({
        eventId: "evt_1",
        timestamp: 1735689600,
        body: '{"a":1}',
      })
    ).toBe('evt_1.1735689600.{"a":1}')
  })
})

describe("signWebhookBody", () => {
  it("produce un HMAC-SHA256 en hex con la versión adelante", () => {
    const signature = signWebhookBody({
      secret: "whsec_test",
      eventId: "evt_1",
      timestamp: 1735689600,
      body: '{"a":1}',
    })
    const expected = createHmac("sha256", "whsec_test")
      .update('evt_1.1735689600.{"a":1}')
      .digest("hex")
    expect(signature).toBe(`v1=${expected}`)
  })

  // El eventId dentro de la firma es lo que impide reusar una firma válida para
  // otro evento con el mismo cuerpo.
  it("cambia si cambia el eventId aunque el cuerpo sea idéntico", () => {
    const base = { secret: "s", timestamp: 1, body: "{}" }
    expect(signWebhookBody({ ...base, eventId: "evt_1" })).not.toBe(
      signWebhookBody({ ...base, eventId: "evt_2" })
    )
  })

  // Y el timestamp es lo que le permite al receptor descartar un replay viejo.
  it("cambia si cambia el timestamp", () => {
    const base = { secret: "s", eventId: "evt_1", body: "{}" }
    expect(signWebhookBody({ ...base, timestamp: 1 })).not.toBe(
      signWebhookBody({ ...base, timestamp: 2 })
    )
  })
})

describe("verifyWebhookSignature", () => {
  const input = {
    secret: "whsec_test",
    eventId: "evt_1",
    timestamp: 1735689600,
    body: '{"a":1}',
  }

  it("acepta la firma que produjo el emisor", () => {
    expect(
      verifyWebhookSignature({ ...input, signature: signWebhookBody(input) })
    ).toBe(true)
  })

  it("rechaza con el secreto equivocado", () => {
    expect(
      verifyWebhookSignature({
        ...input,
        secret: "whsec_otro",
        signature: signWebhookBody(input),
      })
    ).toBe(false)
  })

  it("rechaza si el cuerpo cambió un byte", () => {
    expect(
      verifyWebhookSignature({
        ...input,
        body: '{"a":2}',
        signature: signWebhookBody(input),
      })
    ).toBe(false)
  })

  // `timingSafeEqual` lanza con longitudes distintas, así que la guarda de
  // longitud tiene que ir antes. Sin ella, una firma truncada rompe el receptor
  // en vez de devolver false.
  it("rechaza sin lanzar una firma truncada", () => {
    expect(() =>
      verifyWebhookSignature({ ...input, signature: "v1=abc" })
    ).not.toThrow()
    expect(verifyWebhookSignature({ ...input, signature: "v1=abc" })).toBe(
      false
    )
  })
})

describe("signedWebhookHeaders", () => {
  it("cierra el ciclo: lo que firma el emisor lo verifica el receptor", () => {
    const secret = generateWebhookSigningSecret()
    const body = JSON.stringify({ type: "message", tenant: { id: "t1" } })
    const now = new Date("2026-01-01T00:00:00.000Z")

    const headers = signedWebhookHeaders({
      encryptedSecret: encryptSecret(secret),
      eventId: "evt_abc",
      body,
      now,
    })

    expect(headers["resender-event-id"]).toBe("evt_abc")
    expect(headers["resender-timestamp"]).toBe("1767225600")
    expect(
      verifyWebhookSignature({
        secret,
        eventId: "evt_abc",
        timestamp: 1767225600,
        body,
        signature: headers["resender-signature"]!,
      })
    ).toBe(true)
  })
})
