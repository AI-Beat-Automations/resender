# Phase 1 API migration: baseline and implementation record

Date: 2026-07-29. Branch: `feat/phase-1-api-migration`.

## Pre-change baseline

Executed before implementation:

- `npm run lint`: exit 0; 28,325 pre-existing warnings and 0 errors. Most
  warnings come from generated `.open-next` output traversed by the existing
  lint task.
- `npm run typecheck`: exit 0.
- `npm run test:run`: exit 0; 21 files and 159 tests passed.
- `npm run build`: exit 0; Next.js 16.2.11 production build passed.

No production infrastructure, provider callback, DNS record, secret, Queue, or
database was changed during implementation.

## Existing backend inventory

The migration reviewed the current implementations in:

- Database/auth: `apps/web/lib/db.ts`, `lib/auth/*`,
  `lib/account/account-repository.ts`.
- API keys and crypto: `lib/api-keys/api-keys.ts`,
  `lib/crypto/encryption.ts`, `features/api-keys/*`.
- Meta: `lib/meta.ts`, `app/api/meta/*`, `features/connect-meta/*`,
  `features/connections/*`.
- Billing: `lib/billing/*`, `features/billing/actions.ts`,
  `app/api/stripe/webhook/route.ts`.
- Pages/messages/inbound delivery: `lib/pages/*`, `lib/messages/*`,
  `lib/inbound/*`.
- Product DTO consumers: product layout, settings, connections, conversations,
  billing, auth, and account actions/pages.

Migrations `0001` through `0009` were read in order before designing additive
migration `0010`.

## Compatibility decisions

- `apps/web` handlers, production callback URLs, and runtime configuration are
  unchanged in phase 1.
- Canonical plan keys are `starter_monthly` and `pro_monthly`.
- Specific errors `page_limit_exceeded` and `plan_unavailable` are preserved.
- The approved matrix names generic `plan_restricted`, but phase 1 consciously
  keeps the two established specific codes above instead of exposing that
  generic code; this compatibility deviation must be revisited before adding
  any new plan restriction.
- RPC changes password with only `newPassword`; session authentication remains
  the authority in phase 2.
- Account deletion requires the exact account email as `confirmEmail`.
- Long-lived Meta tokens never cross RPC; `api` exchanges and stores them.
- Queue bodies contain only `{ jobId, messageId }`.
- New columns are nullable where legacy `web` inserts cannot populate them.
- A legacy outbound idempotency row without a fingerprint returns conflict and
  never triggers a provider replay.
- A dedicated idempotency reservation closes the concurrent provider-call
  race before a message row exists.
- PostHog event capture remains in the live `web` callbacks during phase 1.
  The inactive API callback uses Cloudflare structured logs/traces; decide
  whether to move product analytics when callback traffic moves in phase 2.

## Validation record

Final local results:

- `git diff --check`: passed.
- `npm run lint`: passed; the same 28,325 generated-OpenNext warnings and zero
  errors remain.
- `npm run typecheck`: passed for `web`, `api`, contracts, and UI.
- `npm run test:run`: passed:
  - existing `web`: 21 files, 159 tests;
  - `api`: 12 files, 132 tests;
  - contracts: 1 file, 4 tests.
- `npm run build`: passed for Next.js 16.2.11 and the API Wrangler dry run.
  API upload estimate: 1,703.92 KiB / 271.14 KiB gzip.
- `npm --workspace api run cf-typegen:check`: generated bindings are current.
- `npx wrangler check startup --env=""`: local startup analysis passed. Its
  generated CPU profile was removed after inspection.
- `npm run dev`: Next and Wrangler started concurrently; `web` returned 200 on
  port 3000 and API `/healthz` returned 200 with `X-Request-Id` on port 8787.
  The command was then intentionally stopped with Ctrl-C.

`npm audit --omit=dev` reports existing monorepo advisories, including Auth.js,
Next transitive packages, and development-tool chains. The new API direct
runtime dependencies did not introduce a critical advisory; workspace-filtered
high findings resolved through shared development tooling (`eslint`, Vitest,
Vite, and UI/OpenNext chains). No broad `npm audit fix` was applied because it
would make unrelated major-version changes.

External integration tests against Neon, Meta, Stripe, Cloudflare Queues,
custom domains, and real secrets remain manual and are listed in
`docs/api-cloudflare-manual-runbook.md`.
