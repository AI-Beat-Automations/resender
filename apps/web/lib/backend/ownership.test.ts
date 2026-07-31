import { createHash } from "node:crypto"
import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

const WEB_ROOT = process.cwd()
const REPO_ROOT = path.resolve(WEB_ROOT, "../..")
const API_ROOT = path.join(REPO_ROOT, "apps/api")

describe("phase-2 ownership boundaries", () => {
  it("keeps one byte-identical migration history owned by API", async () => {
    const migrations = await readdir(path.join(API_ROOT, "db/migrations"))
    expect(migrations.sort()).toEqual(Object.keys(MIGRATION_HASHES))
    await expectPathMissing(path.join(WEB_ROOT, "db/migrations"))
    await expectPathMissing(path.join(WEB_ROOT, "scripts/migrate.mjs"))
    await expect(
      access(path.join(API_ROOT, "scripts/migrate.mjs"))
    ).resolves.toBeUndefined()

    for (const [file, expectedHash] of Object.entries(MIGRATION_HASHES)) {
      const contents = await readFile(
        path.join(API_ROOT, "db/migrations", file)
      )
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        expectedHash
      )
    }
  })

  it("keeps backend dependencies and secrets out of the web package", async () => {
    const [packageJson, vars, turbo] = await Promise.all([
      readFile(path.join(WEB_ROOT, "package.json"), "utf8"),
      readFile(path.join(WEB_ROOT, ".dev.vars.example"), "utf8"),
      readFile(path.join(REPO_ROOT, "turbo.json"), "utf8"),
    ])
    expect(packageJson).not.toMatch(
      /@neondatabase\/serverless|posthog-node|postgres|"stripe"/u
    )
    expect(vars).not.toMatch(
      /API_KEY_PEPPER|DATABASE_URL|META_APP_SECRET|META_VERIFY_TOKEN|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|TOKEN_ENCRYPTION_KEY/u
    )
    expect(turbo).not.toMatch(
      /API_KEY_PEPPER|DATABASE_URL|META_APP_SECRET|META_VERIFY_TOKEN|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|TOKEN_ENCRYPTION_KEY/u
    )
  })

  it("keeps maintained web sources free of backend domain imports", async () => {
    const files = await sourceFiles(WEB_ROOT)
    const violations: string[] = []
    for (const file of files) {
      const source = await readFile(file, "utf8")
      if (
        /@neondatabase|posthog-node|from\s+["']stripe["']|@\/lib\/(?:api-keys|auth\/waitlist|billing\/(?:entitlement|stripe|subscription|usage)|crypto\/encryption|db|inbound|messages\/message-log|outbound|pages\/page-registry|posthog)["']/u.test(
          source
        )
      ) {
        violations.push(path.relative(WEB_ROOT, file))
      }
    }
    expect(violations).toEqual([])
  })

  it("deploys migrations, API, API smoke, web and web smoke in order", async () => {
    const [workflow, ciWorkflow, apiPackage, webPackage] = await Promise.all([
      readFile(path.join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf8"),
      readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8"),
      readFile(path.join(API_ROOT, "package.json"), "utf8"),
      readFile(path.join(WEB_ROOT, "package.json"), "utf8"),
    ])
    const orderedMarkers = [
      "Run database migrations",
      "npm run db:migrate -w api",
      "Deploy API Worker",
      "Smoke API",
      "Deploy web Worker",
      "Smoke web and BACKEND callback binding",
    ]
    let cursor = -1
    for (const marker of orderedMarkers) {
      const next = workflow.indexOf(marker)
      expect(next).toBeGreaterThan(cursor)
      cursor = next
    }
    expect(workflow).not.toContain("db:migrate -w web")
    expect(ciWorkflow).toContain(
      "npm --workspace @workspace/contracts run test:run"
    )
    expect(workflow).not.toContain("DATABASE_URL: ${{ secrets.DATABASE_URL_MIGRATIONS }}\n\n      - name: Deploy web")
    expect(workflow).toContain('test "$status" = "400"')
    expect(workflow).toContain("https://api.resender.dev/readyz")
    expect(apiPackage).toContain('wrangler deploy --env=\\"\\"')
    expect(apiPackage).toContain('wrangler deploy --dry-run --env=\\"\\"')
    expect(webPackage).toContain('opennextjs-cloudflare deploy --env=\\"\\"')
    expect(webPackage).toContain('opennextjs-cloudflare upload --env=\\"\\"')
  })

  it("marks the phase-1 plan as historical without contradicting private compatibility", async () => {
    const phaseOne = await readFile(
      path.join(REPO_ROOT, "docs/phase-1-api-migration.md"),
      "utf8"
    )
    expect(phaseOne).toContain("Documento histórico y superseded")
    expect(phaseOne).toContain(
      "/internal/legacy/meta/send"
    )
    expect(phaseOne).toContain("esa ruta no existe en el router HTTP público")
    expect(phaseOne).toContain(
      "Contexto de la baseline de Fase 1 que el agente debía conservar"
    )
  })

  it("keeps web backend-secret removal behind an explicit manual cutover gate", async () => {
    const runbook = await readFile(
      path.join(REPO_ROOT, "docs/api-cloudflare-manual-runbook.md"),
      "utf8"
    )
    expect(runbook).toContain(
      "Remove backend secret names from web (manual gate — NOT EXECUTED)"
    )
    for (const name of [
      "API_KEY_PEPPER",
      "DATABASE_URL",
      "TOKEN_ENCRYPTION_KEY",
      "META_APP_SECRET",
      "META_VERIFY_TOKEN",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "META_APP_ID",
    ]) {
      expect(runbook).toContain(name)
    }
    expect(runbook).toContain('wrangler secret list --env=""')
    expect(runbook).toContain("wrangler secret list --env staging")
    expect(runbook).toContain("Do not run `wrangler secret delete`")
    expect(runbook).toContain("ignored\n`apps/web/.env`")
    expect(runbook).toMatch(
      /Keep `AUTH_SECRET`, `APP_URL`, all\s+required `NEXT_PUBLIC_\*`/u
    )
  })
})

async function expectPathMissing(target: string): Promise<void> {
  await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" })
}

async function sourceFiles(root: string): Promise<string[]> {
  const roots = ["app", "components", "features", "lib"].map((directory) =>
    path.join(root, directory)
  )
  const files: string[] = []
  while (roots.length > 0) {
    const current = roots.pop()
    if (!current) break
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) roots.push(target)
      else if (
        /\.(?:ts|tsx)$/u.test(entry.name) &&
        !/\.test\.(?:ts|tsx)$/u.test(entry.name)
      ) {
        files.push(target)
      }
    }
  }
  return files
}

const MIGRATION_HASHES = {
  "0001_mvp_foundation.sql":
    "b7c9b1721724d48a42c66768c1089ac03e942af7bb034fba7f5783ae5860fdcf",
  "0002_account_deletion_cascade.sql":
    "37b8457b7deff2145bccf5bf733c97ba55ffeaa5f4d3254bf928ea7f4d06011e",
  "0003_page_token_health.sql":
    "bfcf12653d10330bc4e1e376e0d129ec5fa24a743f5aea66dab3cf6cd52f5d14",
  "0004_users_waitlist.sql":
    "d18e4c86dfa5c013e31302dc0620bc043ca1b4db6e438961f63ecdc3d546944b",
  "0005_billing.sql":
    "028d365c34175ce4bfe121be1738313893920b9d65e5513eecd53da9ed6fb170",
  "0006_billing_event_order.sql":
    "df27d4ee5cb45ad2f6b1e06eaf99e330d4cca2a599ada867bffdb87eef5b4087",
  "0007_delivery_attempts.sql":
    "b008c095f2bbed5c73cb07997da06b3c80414018a90899353bbaebbe55df8621",
  "0008_outbound_idempotency.sql":
    "d29cacbcba0d475b52002a456f1b9eaed498e4e6b6dc1cb39a3ddada86a6e28e",
  "0009_plan_entitlements.sql":
    "4ceb083fe3278093c0128f570fd7efaac776853ffaa2d577dfd6162127d588f8",
  "0010_api_worker_outbox.sql":
    "7981d203e1238257d794fac2368b945b3ae889c34ce607c441abe5247ceafed5",
} as const
