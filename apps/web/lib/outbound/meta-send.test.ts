import { describe, expect, it, vi } from "vitest"

import {
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
})
