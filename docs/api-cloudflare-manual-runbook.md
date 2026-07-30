# API Worker: manual Cloudflare runbook

Status: phase 1 implementation plus phase 2 preparation. None of the commands
in this runbook were executed against a Cloudflare account while implementing
the branch.

The existing `web` Worker remains the production frontend, database owner, and
live receiver for Meta and Stripe callbacks. Do not change provider callback
URLs until phase 2 has been reviewed and deployed.

## Preconditions

1. Review `apps/api/wrangler.jsonc` and confirm that Rate Limiting
   `namespace_id` values `1001` (production) and `1002` (staging) are positive
   integers unique within the Cloudflare account. Replace them if either is
   already assigned.
2. Create a separate Neon branch/database for staging and local testing.
3. Apply `apps/web/db/migrations/0010_api_worker_outbox.sql` through the
   existing `web` migration pipeline. There is intentionally no second
   migration owner.
4. Confirm the Queue names in the config are unused or intentionally reused.
5. Confirm the Cloudflare account is on a plan that supports Queues and the
   Rate Limiting binding.

## Initialize webhook signing secrets before cutover

Migration `0010` keeps `connected_pages.webhook_signing_secret_encrypted`
nullable because the legacy web application still writes Page rows. The API
Worker deliberately reports `GET /readyz` as `503` while any active Page has a
customer webhook URL but no signing secret.

Before staging or production traffic moves to the API Worker:

1. Identify affected Pages with a read-only query:

   ```sql
   select id, tenant_id, meta_page_id
   from connected_pages
   where status = 'active'
     and webhook_url is not null
     and webhook_signing_secret_encrypted is null
   order by tenant_id, id;
   ```

2. For every row, call
   `POST /v1/pages/{pageId}/webhook-secret/rotate` as that tenant and deliver
   the returned one-time `whsec_...` value to the webhook owner through the
   approved secret channel.
3. Do not write plaintext or an invented encrypted value directly to the
   database. Rotation uses the configured encryption key and records its time.
4. Repeat the read-only query until it returns no rows, then confirm
   `GET /readyz` returns `200`.

The API also refuses to enable a webhook URL on a Page without a signing
secret. Rotate first, store the one-time value at the receiver, then set the
URL. Existing Pages without a customer URL do not block readiness.

## Create resources

Authenticate manually, then run these from the repository root:

```bash
npx wrangler queues create webhook-deliveries
npx wrangler queues create webhook-deliveries-dlq
npx wrangler queues create webhook-deliveries-staging
npx wrangler queues create webhook-deliveries-staging-dlq
```

Do not add invented Queue IDs to `wrangler.jsonc`; Queue bindings use the exact
names above.

## Prepare phase 2 bindings per environment

This section is preparation only. Do not change Wrangler configuration,
Cloudflare bindings, variables, secrets, or deployed Workers until the phase 2
cutover is explicitly approved.

### API web-origin allowlist

The API expects `WEB_APP_ORIGINS` to be a JSON array of exact frontend origins.
It is independent from `PUBLIC_BASE_URL` and must never be derived from the
request hostname. Missing, empty, malformed, or unlisted values fail closed.

Before each environment is enabled, Arturo must approve and record:

```text
production WEB_APP_ORIGINS=["<approved-production-web-origin>"]
staging    WEB_APP_ORIGINS=["<approved-staging-web-origin>"]
local      WEB_APP_ORIGINS=["http://localhost:3000"]
```

Production and staging origins must use HTTPS and contain only the origin: no
path, query, fragment, or credentials. Local HTTP is accepted only for
`localhost`/`127.0.0.1` when `ENVIRONMENT` is `local` or `development`.

When the approved values are later added to `apps/api/wrangler.jsonc`, repeat
the complete `vars` object in every named environment. Wrangler bindings and
variables are non-inheritable, so staging must declare its own
`ENVIRONMENT`, `PUBLIC_BASE_URL`, and `WEB_APP_ORIGINS`; do not assume the
top-level values carry over.

After that future configuration change:

```bash
npm --workspace api run cf-typegen
npm --workspace api run cf-typegen:check
npm --workspace api run typecheck
```

Commit the generated declaration with the configuration change. Do not add a
handwritten global `Env` interface or cast around a missing binding.

### Web-to-API Service Binding

In the future `apps/web` Wrangler configuration, `BACKEND` must be a Service
Binding to the API's named `WebAppApi` entrypoint:

| Caller environment | Binding | Target Worker | Entrypoint |
| --- | --- | --- | --- |
| production `web` | `BACKEND` | `api` | `WebAppApi` |
| staging `web` | `BACKEND` | `api-staging` | `WebAppApi` |
| local development | `BACKEND` | local Worker named `api` | `WebAppApi` |

Declare the service binding explicitly in every environment; service bindings
are also non-inheritable. There must be no production HTTP fallback from RPC
to `https://api.resender.dev`.

After the future `BACKEND` configuration change:

```bash
npm --workspace web run cf-typegen
npm --workspace web run typecheck
npm --workspace api run typecheck
```

Review the generated `CloudflareEnv.BACKEND` type against
`WebAppApiContract`, and verify local Wrangler reports the binding as
connected before running the RPC smoke suite. Do not hand-edit
`apps/web/cloudflare-env.d.ts`.

## Configure secrets

Set every secret separately for staging and production. Never paste values into
`wrangler.jsonc`, `.dev.vars.example`, CI logs, or tickets.

```bash
cd apps/api
npx wrangler secret put DATABASE_URL
npx wrangler secret put AUTH_SECRET
npx wrangler secret put API_KEY_PEPPER
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Repeat with `--env staging`. `API_KEY_PEPPER`, password hashing, and
`TOKEN_ENCRYPTION_KEY` must be compatible with the values used by `web` or
existing credentials/tokens cannot be read. Use a direct Neon URL for schema
migrations and the approved runtime URL for the Worker.

## Validate before deployment

```bash
npm --workspace @workspace/contracts run typecheck
npm --workspace api run cf-typegen:check
npm --workspace api run lint
npm --workspace api run typecheck
npm --workspace api run test:run
npm --workspace api run build
```

The `build` script is a Wrangler dry run. It does not deploy.

## Deploy without moving traffic

After the resources and secrets exist:

```bash
npm --workspace api run deploy:staging
```

Smoke-test staging:

- `GET /healthz` returns `200`.
- `GET /readyz` returns `200` without exposing dependency details.
- `/openapi.json` and `/openapi/download` contain the same document.
- `/docs` loads Swagger UI from `/openapi.json`.
- `WEB_APP_ORIGINS` accepts only the approved staging origin; the production
  origin and arbitrary HTTPS origins are rejected.
- The `BACKEND` Service Binding resolves to the staging API's `WebAppApi`
  entrypoint once phase 2 configuration is approved and applied.
- An absent, malformed, and revoked API key each fail without exposing tenant
  data.
- A controlled Meta/Stripe test signature is accepted; an altered raw body is
  rejected.
- A test inbound event produces one job and a duplicate does not produce a
  second message.
- Delivery outcomes cover 2xx, 408, 429, permanent 4xx, 5xx, timeout, retry,
  and DLQ.

Only after staging evidence is approved:

```bash
npm --workspace api run deploy
```

Creating or deploying the Worker is not authorization to change DNS, the Meta
callback, the Stripe webhook endpoint, or the `web` Worker service bindings.
Those cutovers belong to phase 2.

## Security and architecture notes

- Delivery validates HTTPS/default port/hostname and resolves DNS immediately
  before every request. Workers `fetch` cannot be pinned to the address that
  was checked, so a narrow DNS-rebinding time-of-check/time-of-use risk remains.
  Keep outbound monitoring and consider an egress proxy if the threat model
  later requires address pinning.
- Redirects are always manual, so a customer endpoint cannot redirect the
  Worker into a private network.
- Hyperdrive is deliberately excluded by the approved phase-1 scope. Neon HTTP
  plus Smart Placement is the documented exception; reassess Hyperdrive as a
  separate migration.
- Queue delivery is at least once. Consumers must deduplicate with
  `Resender-Event-Id`.
- Alert on API 5xx, callback signature failures, Queue backlog, DLQ messages,
  provider latency, and webhook delivery failure rate. Logs must never include
  Authorization, cookies, signatures, tokens, passwords, message text, or raw
  provider bodies.

## Rollback

Provider traffic still points at `web`, so rollback is limited:

1. Stop test traffic to `api`.
2. Roll back the `api` Worker version in Cloudflare.
3. Leave migration `0010` in place; it is additive and compatible with legacy
   `web` inserts.
4. Do not purge the Queue or DLQ. Inspect and reconcile jobs using the DLQ
   runbook.

The source files `docs/domain.md` and `prd_api_separation.md` referenced by the
planning document were absent. `CONTEXT.md`, migrations `0001`–`0009`, current
production code, and `docs/phase-1-api-migration.md` were used as the canonical
inputs.
