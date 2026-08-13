import { describe, expect, it } from "vitest"

import {
  AttachmentSchema,
  ErrorEnvelopeSchema,
  MessageContentSchema,
  PageSchema,
  SendMessageSchema,
  WebhookSecretSchema,
} from "./index"

const pageFixture = {
  id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
  provider: "meta",
  channel: "messenger",
  providerPageId: "10987654321",
  name: "Acme",
  username: null,
  wabaId: null,
  phoneE164: null,
  onboardingMode: null,
  whatsappStatus: null,
  status: "active",
  tokenStatus: "valid",
  webhook: { url: null, signingEnabled: false },
  connectedAt: "2026-07-29T18:00:00.000Z",
  updatedAt: "2026-07-29T18:00:00.000Z",
}

describe("public contracts", () => {
  it("keeps the v1 page id distinct from the provider id", () => {
    const result = PageSchema.safeParse(pageFixture)

    expect(result.success).toBe(true)
  })

  // Instagram **es** Meta: comparten la app, el sobre de error de Graph y la
  // firma del webhook. Lo que cambia es la superficie, y por eso el canal es un
  // campo aparte de `provider` en vez de un valor suyo.
  it("discriminates the channel without touching the provider", () => {
    const instagram = PageSchema.safeParse({
      ...pageFixture,
      channel: "instagram",
      providerPageId: "17841400000000000",
      username: "acme",
    })

    expect(instagram.success).toBe(true)
    expect(instagram.success && instagram.data.provider).toBe("meta")
  })

  // WhatsApp es el tercer canal del mismo provider. `providerPageId` es el
  // phone_number_id y la identidad extra (WABA, número, modo) va en campos
  // planos, con el mismo criterio que `username`.
  it("models whatsapp as a channel of the meta provider", () => {
    const whatsapp = PageSchema.safeParse({
      ...pageFixture,
      channel: "whatsapp",
      providerPageId: "111222333444555",
      wabaId: "987654321",
      phoneE164: "+5215555555555",
      onboardingMode: "coexistence",
      whatsappStatus: { coexistence: "connected", historySync: "in_progress" },
    })

    expect(whatsapp.success).toBe(true)
    expect(whatsapp.success && whatsapp.data.onboardingMode).toBe("coexistence")
  })

  it("requires the approved text message shape", () => {
    expect(
      SendMessageSchema.safeParse({
        pageId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
        recipientId: "psid",
        type: "text",
        text: "Hello",
      }).success
    ).toBe(true)
    expect(
      SendMessageSchema.safeParse({
        pageId: "10987654321",
        recipientId: "psid",
        type: "image",
      }).success
    ).toBe(false)
  })

  // El media saliente referencia un upload previo por `mediaId`; una URL
  // arbitraria del cliente no entra al esquema (SSRF, enlaces caducos y
  // contenido que muta después de calcular la idempotencia).
  it("accepts media sends only by upload reference", () => {
    expect(
      SendMessageSchema.safeParse({
        pageId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
        recipientId: "5215555555555",
        type: "document",
        mediaId: "0b54b945-9917-4c60-a1d5-5c1cb1f7f2f9",
        caption: "Tu factura",
      }).success
    ).toBe(true)
    expect(
      SendMessageSchema.safeParse({
        pageId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
        recipientId: "5215555555555",
        type: "document",
        url: "https://attacker.example/factura.pdf",
      }).success
    ).toBe(false)
    // Audio y sticker no llevan caption en Cloud API: la variante no lo
    // declara y zod lo stripea, como a cualquier llave desconocida de la API.
    const audio = SendMessageSchema.safeParse({
      pageId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
      recipientId: "5215555555555",
      type: "audio",
      mediaId: "0b54b945-9917-4c60-a1d5-5c1cb1f7f2f9",
      caption: "no va",
    })
    expect(audio.success).toBe(true)
    expect(audio.success && "caption" in audio.data).toBe(false)
  })

  // Un tipo que Resender no modela se conserva como evento genérico con su
  // payload, nunca se disfraza de texto ni se descarta.
  it("keeps unknown message types as generic events", () => {
    const parsed = MessageContentSchema.safeParse({
      kind: "generic_event",
      eventType: "order",
      raw: { catalog_id: "c1", product_items: [] },
    })

    expect(parsed.success).toBe(true)
  })

  // La URL de descarga solo existe cuando el objeto ya está en R2; un adjunto
  // pending o failed nunca expone la URL temporal de Meta.
  it("shapes attachments with a nullable authenticated download url", () => {
    expect(
      AttachmentSchema.safeParse({
        id: "0b54b945-9917-4c60-a1d5-5c1cb1f7f2f9",
        kind: "document",
        mimeType: "application/pdf",
        filename: "factura.pdf",
        caption: null,
        sizeBytes: 12345,
        sha256: null,
        status: "pending",
        downloadUrl: null,
      }).success
    ).toBe(true)
  })

  it("never accepts an unprefixed signing secret", () => {
    expect(
      WebhookSecretSchema.safeParse({
        secret: "not-a-webhook-secret",
        createdAt: "2026-07-29T18:00:00.000Z",
      }).success
    ).toBe(false)
  })

  it("restricts error envelopes to the canonical error-code enum", () => {
    const envelope = {
      error: {
        code: "account_waitlisted",
        message: "Restricted",
        requestId: "request_1",
      },
    }
    expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(true)
    expect(
      ErrorEnvelopeSchema.safeParse({
        ...envelope,
        error: { ...envelope.error, code: "invented_error" },
      }).success
    ).toBe(false)
  })
})
