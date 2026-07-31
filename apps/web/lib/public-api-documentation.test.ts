import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import { DOCS_URL } from "./site-config"

const rootFile = (path: string) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8")

describe("public API documentation", () => {
  it("links product navigation and /docs to the current OpenAPI UI", async () => {
    const nextConfig = await rootFile("apps/web/next.config.ts")

    expect(DOCS_URL).toBe("https://api.resender.dev/docs")
    expect(nextConfig).not.toContain("https://docs.resender.dev")
    expect(nextConfig).toContain('source: "/docs"')
    expect(nextConfig).toContain("destination: DOCS_URL")
    expect(nextConfig).toContain("permanent: false")
  })

  it("publishes the canonical references and webhook guarantees", async () => {
    const [readme, guide] = await Promise.all([
      rootFile("README.md"),
      rootFile("docs/api-v1-guide.md"),
    ])

    for (const document of [readme, guide]) {
      expect(document).toContain("https://api.resender.dev/docs")
      expect(document).toContain("https://api.resender.dev/openapi.json")
      expect(document).toContain("https://api.resender.dev/openapi/download")
      expect(document).toContain("https://api.resender.dev/v1/messages")
      expect(document).toContain("Idempotency-Key")
      expect(document).toContain("recipientId")
      expect(document).toContain('"type": "text"')
      expect(document).toContain('"text":')
      expect(document.toLowerCase()).toContain("at least once")
      expect(document).toContain("Resender-Signature")
      expect(document).toContain("Resender-Event-Id")
    }

    expect(guide).toContain(
      "A `409 idempotency_conflict` does not prove the key is free"
    )
    expect(guide).toMatch(
      /For a `422` or\s+`502` provider response without `details\.messageId`/u
    )
    expect(guide).toMatch(
      /This conclusion\s+does not apply to `409` or to unrelated error statuses/u
    )
  })

  it("does not present the legacy send or provider callbacks as current", async () => {
    const [
      context,
      seoHandoff,
      designDecisions,
      websiteSpec,
      cloudflareHandoff,
      infraChecklist,
      apiRunbook,
    ] = await Promise.all([
      rootFile("CONTEXT.md"),
      rootFile("SEO-GEO-IMPLEMENTATION.md"),
      rootFile("website-design-decisions.md"),
      rootFile("resender-website-spec.md"),
      rootFile("handoff_cloudflare.md"),
      rootFile("docs/cloudflare-infra-checklist.md"),
      rootFile("docs/api-cloudflare-manual-runbook.md"),
    ])

    expect(context).not.toContain("`POST /api/meta/send` recibe")
    expect(seoHandoff).not.toContain(
      "curl -X POST https://resender.dev/api/meta/send"
    )
    expect(designDecisions).not.toContain(
      "Snippet = el POST real a `/api/meta/send`"
    )
    expect(websiteSpec).toContain("https://api.resender.dev/docs")
    expect(cloudflareHandoff).toContain("Documento historico/superseded")
    expect(infraChecklist).toContain("Documento histórico/superseded")
    expect(apiRunbook).toContain("https://api.resender.dev")
    expect(apiRunbook).toContain("Those cutovers remain manual")
  })
})
