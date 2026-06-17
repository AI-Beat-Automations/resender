import { describe, expect, it } from "vitest"

import { formatContactLabel } from "./display"

describe("message display helpers", () => {
  it("falls back to a human-readable PSID label", () => {
    expect(formatContactLabel(null, "12345")).toBe("PSID 12345")
    expect(formatContactLabel("", "12345")).toBe("PSID 12345")
    expect(formatContactLabel("Ada", "12345")).toBe("Ada")
  })
})
