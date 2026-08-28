import { describe, expect, it, vi } from "vitest"

import {
  describeMetaError,
  explainMetaError,
  extractMetaErrorCode,
  extractMetaErrorMessage,
  isMetaExpiredTokenError,
  sendMetaMessage,
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
      sendMetaMessage({
        pageId: "page-1",
        pageAccessToken: "token",
        recipientId: "psid-1",
        message: { text: "hola" },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 400,
      error: "Error validating access token",
      // Un error de token no es de adjunto: sin código estable.
      code: null,
    })

    vi.restoreAllMocks()
  })

  it("sends each attachment type with Graph's attachment payload", async () => {
    for (const type of ["image", "video", "audio", "file"] as const) {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message_id: "mid.1" }), {
          status: 200,
        })
      )

      const result = await sendMetaMessage({
        pageId: "page-1",
        pageAccessToken: "token",
        recipientId: "psid-1",
        message: {
          attachment: { type, url: "https://cdn.example.com/a.bin" },
        },
      })

      expect(result).toMatchObject({ ok: true, status: 200, code: null })
      const [, init] = fetchSpy.mock.calls.at(-1)!
      expect(JSON.parse(init?.body as string)).toEqual({
        recipient: { id: "psid-1" },
        messaging_type: "RESPONSE",
        message: {
          attachment: {
            type,
            payload: { url: "https://cdn.example.com/a.bin" },
          },
        },
      })

      vi.restoreAllMocks()
    }
  })

  it("populates the stable code when Meta rejects an attachment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message:
              "(#546) The type of file you're trying to attach isn't allowed.",
            type: "OAuthException",
            code: 546,
          },
        }),
        { status: 400 }
      )
    )

    await expect(
      sendMetaMessage({
        pageId: "page-1",
        pageAccessToken: "token",
        recipientId: "psid-1",
        message: {
          attachment: { type: "file", url: "https://cdn.example.com/a.exe" },
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 400,
      code: "attachment_format_rejected",
    })

    vi.restoreAllMocks()
  })

  it("describes attachment failures with stable codes", () => {
    const rejected = describeMetaError({ error: { code: 546 } })
    expect(rejected?.code).toBe("attachment_format_rejected")
    expect(rejected?.message).toMatch(/format/)

    const fetchFailed = describeMetaError({
      error: { code: 100, error_subcode: 2018047 },
    })
    expect(fetchFailed?.code).toBe("attachment_fetch_failed")
    expect(fetchFailed?.message).toMatch(/download/)
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
    expect(explainMetaError({ error: { code: 190 } })).toMatch(
      /Reconnect the Page/
    )
    expect(explainMetaError({ error: { code: 551 } })).toMatch(
      /isn't available/
    )
    expect(explainMetaError({ error: { code: 613 } })).toMatch(/rate limit/)
  })

  // Las traducciones viejas no ganan código estable: solo los fallos de
  // adjunto lo llevan, y `explainMetaError` sigue devolviendo los mismos
  // strings de siempre.
  it("keeps legacy translations without stable codes", () => {
    const legacy = [
      { error: { code: 190 } },
      { error: { code: 10, error_subcode: 2018278 } },
      { error: { code: 10 } },
      { error: { code: 551 } },
      { error: { code: 100, error_subcode: 2018001 } },
      { error: { code: 4 } },
      { error: { code: 613 } },
      { error: { code: 368 } },
    ]

    for (const data of legacy) {
      const described = describeMetaError(data)
      expect(described).not.toBeNull()
      expect(described?.code).toBeNull()
      expect(explainMetaError(data)).toBe(described?.message)
    }

    expect(
      explainMetaError({ error: { code: 100, error_subcode: 2018001 } })
    ).toBe(
      "No matching user found: the recipient ID (PSID) doesn't belong to this Page."
    )
  })

  it("returns null for unknown errors so the raw Meta message is used", () => {
    expect(explainMetaError({ error: { code: 999999 } })).toBeNull()
    expect(explainMetaError(null)).toBeNull()
    // Un `100` genérico sin subcode sigue sin traducirse: el catálogo lo
    // comparten los envíos de texto.
    expect(describeMetaError({ error: { code: 100 } })).toBeNull()
    expect(explainMetaError({ error: { code: 100 } })).toBeNull()
  })
})
