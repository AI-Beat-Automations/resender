import { describe, expect, it } from "vitest"

import { rateLimitFamily } from "./config"

describe("rate limit families", () => {
  it("keeps reads and page writes where they were", () => {
    expect(rateLimitFamily("GET", "/v1/messages")).toBe("read")
    expect(rateLimitFamily("GET", "/v1/comments")).toBe("read")
    expect(rateLimitFamily("PATCH", "/v1/pages/abc")).toBe("page_write")
    expect(rateLimitFamily("POST", "/v1/pages/abc/webhook-secret/rotate")).toBe(
      "secret_rotation"
    )
  })

  // Las respuestas a comentarios comparten cubeta con el envío de mensajes: son
  // la misma clase de operación —salir hacia Meta por cada evento entrante— y
  // con cubetas separadas un tenant podría duplicar su presión sobre Graph sin
  // tocar su límite de mensajes.
  it("charges comment replies to the message-send bucket", () => {
    expect(rateLimitFamily("POST", "/v1/messages")).toBe("message_send")
    expect(
      rateLimitFamily(
        "POST",
        "/v1/comments/1f0c9b2e-6d2a-4a5f-9f43-2f9a4b6d0c11/replies"
      )
    ).toBe("message_send")
    expect(
      rateLimitFamily(
        "POST",
        "/v1/comments/1f0c9b2e-6d2a-4a5f-9f43-2f9a4b6d0c11/private-replies"
      )
    ).toBe("message_send")
  })

  it("does not let a nested path masquerade as a reply route", () => {
    expect(rateLimitFamily("POST", "/v1/comments/abc/replies/extra")).toBe(
      "page_write"
    )
  })
})
