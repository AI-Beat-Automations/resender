import { describe, expect, it, vi } from "vitest"

import {
  explainMetaError,
  extractMetaErrorCode,
  extractMetaErrorMessage,
  isMetaExpiredTokenError,
  sendMetaTextMessage,
} from "./meta-send"

describe("Meta send helpers", () => {
  it("detects expired Page token errors from Meta", () => {
    const response = {
      error: {
        message: "Error validating access token",
        type: "OAuthException",
        code: 190,
      },
    }

    expect(extractMetaErrorCode(response)).toBe(190)
    expect(extractMetaErrorMessage(response)).toBe(
      "Error validating access token"
    )
    expect(isMetaExpiredTokenError(response)).toBe(true)
  })

  it("returns Meta error messages for failed sends", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: "Error validating access token",
            type: "OAuthException",
            code: 190,
          },
        }),
        { status: 400 }
      )
    )

    await expect(
      sendMetaTextMessage({
        pageId: "page-1",
        pageAccessToken: "token",
        recipientId: "psid-1",
        text: "hola",
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 400,
      error: "Error validating access token",
    })

    vi.restoreAllMocks()
  })

  it("translates the closed 24-hour window error", () => {
    const response = {
      error: {
        message: "This message is sent outside of allowed window.",
        type: "OAuthException",
        code: 10,
        error_subcode: 2018278,
      },
    }

    expect(explainMetaError(response)).toMatch(/24-hour window/)
  })

  it("translates expired token and unavailable person errors", () => {
    expect(explainMetaError({ error: { code: 190 } })).toMatch(/Reconnect the Page/)
    expect(explainMetaError({ error: { code: 551 } })).toMatch(/isn't available/)
    expect(explainMetaError({ error: { code: 613 } })).toMatch(/rate limit/)
  })

  it("returns null for unknown errors so the raw Meta message is used", () => {
    expect(explainMetaError({ error: { code: 999999 } })).toBeNull()
    expect(explainMetaError(null)).toBeNull()
  })
})
