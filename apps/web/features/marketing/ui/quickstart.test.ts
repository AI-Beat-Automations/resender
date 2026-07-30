import { describe, expect, it } from "vitest"

import { buildSnippets } from "./quickstart-snippets"

describe("public API quickstart", () => {
  const snippets = buildSnippets("Hello")

  it("uses the v1 message endpoint and mandatory idempotency in every language", () => {
    for (const snippet of snippets) {
      expect(snippet.code).toContain("https://api.resender.dev/v1/messages")
      expect(snippet.code).toContain("Idempotency-Key")
      expect(snippet.code).not.toContain("https://resender.dev/api/meta/send")
    }
  })

  it("uses an internal Page UUID and the v1 text payload", () => {
    for (const snippet of snippets) {
      expect(snippet.code).toContain(
        "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"
      )
      expect(snippet.code).toMatch(/["']?type["']?:\s*["']text["']/u)
      expect(snippet.code).toMatch(/["']?text["']?:\s*["']Hello["']/u)
      expect(snippet.code).not.toMatch(/["']?reply["']?:/u)
    }
  })
})
