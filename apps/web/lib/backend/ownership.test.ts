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

  it("isolates API tests from product development secrets", async () => {
    const [vitestConfig, testWranglerConfig, apiPackageSource] =
      await Promise.all([
        readFile(path.join(API_ROOT, "vitest.config.ts"), "utf8"),
        readFile(path.join(API_ROOT, "test/wrangler.jsonc"), "utf8"),
        readFile(path.join(API_ROOT, "package.json"), "utf8"),
      ])
    const apiPackage = JSON.parse(apiPackageSource) as {
      scripts: Record<string, string>
    }
    const testConfigPath = path.join(API_ROOT, "test/wrangler.jsonc")

    expect(path.dirname(testConfigPath)).not.toBe(API_ROOT)
    await expectPathMissing(
      path.join(path.dirname(testConfigPath), ".dev.vars")
    )
    expect(vitestConfig).toContain(
      'const TEST_WRANGLER_CONFIG = "./test/wrangler.jsonc"'
    )
    expect(vitestConfig).not.toMatch(
      /wrangler:\s*\{\s*configPath:\s*["']\.\/wrangler\.jsonc["']/u
    )
    expect(testWranglerConfig).toContain('"main": "../src/index.ts"')
    expect(testWranglerConfig).toContain(
      '"compatibility_flags": ["nodejs_compat"]'
    )
    expect(testWranglerConfig).not.toContain('"secrets"')
    for (const script of ["test", "test:run"]) {
      expect(apiPackage.scripts[script]).toMatch(
        /^CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false vitest/u
      )
    }
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
    expect(ciWorkflow).toContain(
      "npm --workspace web exec -- opennextjs-cloudflare build"
    )
    for (const workspace of [
      "@workspace/contracts",
      "@workspace/ui",
      "api",
      "web",
    ]) {
      expect(ciWorkflow).toContain(
        `npm --workspace ${workspace} run typecheck -- --incremental false`
      )
    }
    expect(workflow).not.toContain(
      "DATABASE_URL: ${{ secrets.DATABASE_URL_MIGRATIONS }}\n\n      - name: Deploy web"
    )
    expect(workflow).toContain('test "$status" = "400"')
    expect(workflow).toContain("https://api.resender.dev/readyz")
    expect(apiPackage).toContain('wrangler deploy --env=\\"\\"')
    expect(apiPackage).toContain('wrangler deploy --dry-run --env=\\"\\"')
    expect(webPackage).toContain('opennextjs-cloudflare deploy --env=\\"\\"')
    expect(webPackage).toContain('opennextjs-cloudflare upload --env=\\"\\"')
  })

  it("declares exact production and staging routes with connected service bindings", async () => {
    const [apiConfig, webConfig, typegenScript, webPackageSource] =
      await Promise.all([
        readFile(path.join(API_ROOT, "wrangler.jsonc"), "utf8"),
        readFile(path.join(WEB_ROOT, "wrangler.jsonc"), "utf8"),
        readFile(path.join(WEB_ROOT, "scripts/cf-typegen.mjs"), "utf8"),
        readFile(path.join(WEB_ROOT, "package.json"), "utf8"),
      ])
    const webPackage = JSON.parse(webPackageSource) as {
      scripts: Record<string, string>
    }

    expect(apiConfig.match(/"pattern": "api\.resender\.dev"/gu)).toHaveLength(1)
    expect(
      apiConfig.match(/"pattern": "api-staging\.resender\.dev"/gu)
    ).toHaveLength(1)
    expect(apiConfig).toMatch(
      /"pattern": "api\.resender\.dev", "custom_domain": true/u
    )
    expect(apiConfig).toMatch(
      /"pattern": "api-staging\.resender\.dev",\s+"custom_domain": true/gu
    )

    expect(webConfig.match(/"pattern": "resender\.dev"/gu)).toHaveLength(1)
    expect(
      webConfig.match(/"pattern": "staging\.resender\.dev"/gu)
    ).toHaveLength(1)
    expect(webConfig).toMatch(
      /"pattern": "resender\.dev", "custom_domain": true/u
    )
    expect(webConfig).toMatch(
      /"pattern": "staging\.resender\.dev",\s+"custom_domain": true/u
    )
    expect(webConfig).toMatch(
      /"binding": "BACKEND",\s+"service": "api",\s+"entrypoint": "WebAppApi"/u
    )
    expect(webConfig).toMatch(
      /"binding": "BACKEND",\s+"service": "api-staging",\s+"entrypoint": "WebAppApi"/u
    )
    expect(typegenScript).toContain("experimental_readRawConfig")
    expect(typegenScript).toContain("delete rawConfig.main")
    expect(typegenScript).toContain('"../api/wrangler.jsonc"')
    expect(typegenScript).toContain('"--env-file"')
    expect(typegenScript).toContain(
      'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false"'
    )
    expect(webPackage.scripts["cf-typegen"]).toBe("node scripts/cf-typegen.mjs")
    expect(webPackage.scripts["cf-typegen:check"]).toBe(
      "node scripts/cf-typegen.mjs --check"
    )

    expect(webPackage.scripts["build:staging"]).toBe(
      "opennextjs-cloudflare build"
    )
    expect(webPackage.scripts["deploy:staging"]).toBe(
      "npm run build:staging && opennextjs-cloudflare deploy --env staging"
    )
  })

  it("keeps production deployment manual, confirmed, main-only and environment-gated", async () => {
    const workflow = await readFile(
      path.join(REPO_ROOT, ".github/workflows/deploy.yml"),
      "utf8"
    )

    expect(workflow).not.toMatch(/^\s+push:/mu)
    expect(workflow).toMatch(
      /workflow_dispatch:\s+inputs:\s+confirm:[\s\S]*required: true[\s\S]*type: string/u
    )
    expect(workflow).toContain("inputs.confirm == 'DEPLOY_PRODUCTION'")
    expect(workflow).toContain("github.ref == 'refs/heads/main'")
    expect(workflow).toMatch(/^\s+environment: production$/mu)
  })

  it("documents staging order, build-time vars, custom-domain checks and rollback", async () => {
    const [runbook, checklist, phaseOne] = await Promise.all([
      readFile(
        path.join(REPO_ROOT, "docs/api-cloudflare-manual-runbook.md"),
        "utf8"
      ),
      readFile(
        path.join(REPO_ROOT, "docs/cloudflare-infra-checklist.md"),
        "utf8"
      ),
      readFile(path.join(REPO_ROOT, "docs/phase-1-api-migration.md"), "utf8"),
    ])
    const orderedMarkers = [
      "npm --workspace api run deploy:staging",
      "https://api-staging.resender.dev/readyz",
      "npm --workspace web run deploy:staging",
      "https://staging.resender.dev/",
    ]
    let cursor = -1
    for (const marker of orderedMarkers) {
      const next = runbook.indexOf(marker, cursor + 1)
      expect(next).toBeGreaterThan(cursor)
      cursor = next
    }

    for (const hostname of [
      "api.resender.dev",
      "api-staging.resender.dev",
      "resender.dev",
      "staging.resender.dev",
    ]) {
      expect(runbook).toContain(hostname)
    }
    for (const variable of [
      "APP_URL",
      "NEXT_PUBLIC_META_APP_ID",
      "NEXT_PUBLIC_META_CONFIG_ID",
      "NEXT_PUBLIC_POSTHOG_KEY",
      "NEXT_PUBLIC_POSTHOG_HOST",
    ]) {
      expect(runbook).toContain(variable)
    }
    expect(runbook).toContain("required reviewers")
    expect(runbook).toContain("No custom-domain, DNS, TLS, Worker deployment")
    expect(runbook).toContain("wrangler rollback --env staging")

    expect(checklist).toContain("Documento histórico/superseded")
    expect(checklist).toContain("api-cloudflare-manual-runbook.md")
    expect(checklist).not.toMatch(
      /wrangler\s+secret\s+put|wrangler\s+deploy|npm\s+run\s+deploy/u
    )
    expect(phaseOne).not.toContain("phase-2-api-migration-frontend.md")
  })

  it("runs Next and the named local API Worker under Turbo", async () => {
    const [
      rootPackageSource,
      webPackageSource,
      apiPackageSource,
      devScript,
      nextConfig,
      runbook,
    ] = await Promise.all([
      readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
      readFile(path.join(WEB_ROOT, "package.json"), "utf8"),
      readFile(path.join(API_ROOT, "package.json"), "utf8"),
      readFile(path.join(WEB_ROOT, "scripts/dev.mjs"), "utf8"),
      readFile(path.join(WEB_ROOT, "next.config.ts"), "utf8"),
      readFile(
        path.join(REPO_ROOT, "docs/api-cloudflare-manual-runbook.md"),
        "utf8"
      ),
    ])
    const rootPackage = JSON.parse(rootPackageSource) as {
      scripts: Record<string, string>
    }
    const webPackage = JSON.parse(webPackageSource) as {
      scripts: Record<string, string>
    }
    const apiPackage = JSON.parse(apiPackageSource) as {
      scripts: Record<string, string>
    }

    expect(rootPackage.scripts.dev).toBe("turbo dev")
    expect(rootPackage.scripts).not.toHaveProperty("dev:next")
    expect(webPackage.scripts.dev).toBe("node scripts/dev.mjs")
    expect(apiPackage.scripts.dev).toBe("wrangler dev --local --port 8787")
    expect(devScript).toContain('const API_WORKER_NAME = "api"')
    expect(devScript).toContain("STARTUP_TIMEOUT_MS")
    expect(devScript).toContain("debugPortAddress")
    expect(devScript).toContain("userWorkerService")
    expect(devScript).toContain('"next/dist/bin/next"')
    expect(devScript).not.toMatch(/https?:\/\//u)
    expect(nextConfig).toContain("initOpenNextCloudflareForDev()")
    expect(runbook).toContain("http://localhost:3000/")
    expect(runbook).toContain("port `8787`")
    expect(runbook).toContain("local Worker named `api`")
    expect(runbook).toContain('= "401"')
    expect(runbook).toContain('= "400"')
    expect(runbook).toContain("/api/meta/webhook")
    expect(runbook).toContain("/api/stripe/webhook")
    expect(runbook).toMatch(/Hot Module\s+Replacement/u)
    expect(runbook).toContain("no HTTP fallback")
  })

  it("marks the phase-1 plan as historical without contradicting private compatibility", async () => {
    const phaseOne = await readFile(
      path.join(REPO_ROOT, "docs/phase-1-api-migration.md"),
      "utf8"
    )
    expect(phaseOne).toContain("Documento histórico y superseded")
    expect(phaseOne).toContain("/internal/legacy/meta/send")
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
