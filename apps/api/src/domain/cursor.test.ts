import { describe, expect, it } from "vitest"

import { decodeCursor, encodeCursor } from "./cursor"

describe("opaque cursors", () => {
  it("round trips a stable tuple without exposing it as plain JSON", () => {
    const value = {
      at: "2026-07-29T18:00:00.000Z",
      id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
    }
    const cursor = encodeCursor(value)
    expect(cursor).not.toContain(value.id)
    expect(decodeCursor(cursor)).toEqual(value)
  })

  it.each(["not-base64!", btoa("{}"), btoa('{"at":"bad","id":"x"}')])(
    "maps malformed value to a validation error",
    (cursor) => {
      expect(() => decodeCursor(cursor)).toThrow("cursor is invalid")
    }
  )

  it("rejects a valid ISO timestamp paired with an invalid UUID", () => {
    const cursor = encodeCursor({
      at: "2026-07-29T18:00:00.000Z",
      id: "not-a-uuid",
    })
    expect(() => decodeCursor(cursor)).toThrow(
      expect.objectContaining({
        code: "validation_error",
        status: 400,
        details: [{ path: "cursor", message: "Invalid cursor" }],
      })
    )
  })
})
