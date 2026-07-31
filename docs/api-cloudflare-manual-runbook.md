# API Worker: manual Cloudflare runbook

Status: phase 1 implementation plus the phase 2 repository configuration and
callback-proxy checkpoints. The origin allowlists, Service Bindings,
deterministic typegen, generated types, API callback ownership, and thin legacy
web callback proxies are present in the repository. None of the deploy,
provider-dashboard, DNS, secret, or other Cloudflare-account commands in this
runbook were executed while implementing the branch.

The existing `web` Worker remains the production frontend. `apps/api`
exclusively owns the migration history/runner, database and backend secrets,
provider clients and domain side effects. The legacy Meta/Stripe callbacks and
deprecated send Route Handler in web are raw streaming proxies through
`BACKEND`; they contain no authentication, signature verification, provider
client, database write, analytics, or domain side effect. Until the ordered
cutovers below are executed and recorded, assume clients/providers still use
the legacy web URLs. Do not disable any of the three proxies based only on the
repository state.

## Preconditions

1. Review `apps/api/wrangler.jsonc` and confirm that Rate Limiting
   `namespace_id` values `1001` (production) and `1002` (staging) are positive
   integers unique within the Cloudflare account. Replace them if either is
   already assigned.
2. Create a separate Neon branch/database for staging and local testing.
3. Apply `apps/api/db/migrations/0010_api_worker_outbox.sql` through
   `npm --workspace api run db:migrate`. There is intentionally no second
   migration directory or runner in web.
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

`GET /readyz` deliberately returns only `{"status":"unavailable"}` with status
`503` for every failure. Correlate its `x-request-id` with the structured
`readiness_check` log and use only its sanitized `readinessCategory`:

- `configuration`: validate the presence and syntax of the approved Worker
  variables and secrets without printing their values.
- `database`: validate database reachability and the readiness queries. This
  category also covers a malformed unsigned-Page count; never treat it as zero.
- `unsigned_webhook_pages`: use the read-only query above to identify the
  blocking Pages through an approved database session.
- `ready`: both database checks passed and no configured webhook lacks a
  signing secret.

Stop if a blocking Page belongs to a tenant that is waitlisted, lacks an active
subscription, or has no usable API key. Do not issue a manual `UPDATE`, invent
ciphertext, bypass the product gates, or weaken readiness. With explicit
authorization, either restore legitimate access through the supported
account/billing/API-key flows and rotate the secret normally, or disconnect the
Page through the supported UI/RPC flow with tenant-owner authorization.
Disconnect preserves history; it is not permission to delete or rewrite the
Page row. If neither path is authorized, leave readiness unavailable and
escalate the ownership decision.

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

## Phase 2 bindings configured per environment

This repository configuration has been applied after explicit approval. It
declares the production and staging custom domains, but does not deploy either
Worker, create external resources, set secrets, change DNS, attach those
domains in the Cloudflare account, or issue TLS certificates. Those actions
remain manual cutover steps.

### API web-origin allowlist

The API expects `WEB_APP_ORIGINS` to be a JSON array of exact frontend origins.
It is independent from `PUBLIC_BASE_URL` and must never be derived from the
request hostname. Missing, empty, malformed, or unlisted values fail closed.

The approved repository values are:

```text
production WEB_APP_ORIGINS=["https://resender.dev"]
staging    WEB_APP_ORIGINS=["https://staging.resender.dev"]
local      WEB_APP_ORIGINS=["http://localhost:3000"]
```

Production and staging origins must use HTTPS and contain only the origin: no
path, query, fragment, or credentials. Local HTTP is accepted only for
`localhost`/`127.0.0.1` when `ENVIRONMENT` is `local` or `development`.

The approved values are recorded in `apps/api/wrangler.jsonc`, with the
complete `vars` object repeated in every named environment. Wrangler bindings
and variables are non-inheritable, so staging declares its own
`ENVIRONMENT`, `PUBLIC_BASE_URL`, and `WEB_APP_ORIGINS`; do not assume the
top-level values carry over.

After any future configuration change:

```bash
npm --workspace api run cf-typegen
npm --workspace api run cf-typegen:check
npm --workspace api run typecheck
```

Commit the generated declaration with the configuration change. Do not add a
handwritten global `Env` interface or cast around a missing binding.

### Web-to-API Service Binding

The current `apps/web` Wrangler configuration declares `BACKEND` as a Service
Binding to the API's named `WebAppApi` entrypoint:

| Caller environment | Binding   | Target Worker            | Entrypoint  |
| ------------------ | --------- | ------------------------ | ----------- |
| production `web`   | `BACKEND` | `api`                    | `WebAppApi` |
| staging `web`      | `BACKEND` | `api-staging`            | `WebAppApi` |
| local development  | `BACKEND` | local Worker named `api` | `WebAppApi` |

Declare the service binding explicitly in every environment; service bindings
are also non-inheritable. There must be no production HTTP fallback from RPC
to `https://api.resender.dev`.

After any future `BACKEND` configuration change:

```bash
npm --workspace web run cf-typegen
npm --workspace web run cf-typegen:check
npm --workspace web run typecheck
npm --workspace api run typecheck
```

Web type generation derives `.wrangler-typegen.json` from the tracked
`apps/web/wrangler.jsonc` with Wrangler's own JSONC parser, then omits only
`main`. This preserves the real `ASSETS`, routes and production/staging
`BACKEND` bindings while preventing the ignored `.open-next/worker.js` build
artifact from changing generated declarations. The derived config is ignored
and is not a second source of truth; `cf-typegen:check` still executes
Wrangler's real `types --check`.

Review the generated `CloudflareEnv.BACKEND` type against
`WebAppApiContract`, and verify local Wrangler reports the binding as
connected before running the RPC smoke suite. Do not hand-edit
`apps/web/cloudflare-env.d.ts`.

### Slice 1 RPC gate

Slice 0 validates the server-only adapter with a mocked OpenNext context and
validates the API health method through the real named entrypoint in the
Workers test runtime. This is layered coverage, not an end-to-end OpenNext
adapter-to-RPC smoke test.

Before migrating the first frontend consumer in Slice 1, run `web` and `api`
together with a local Workers runtime whose supported compatibility date
matches both configs. Wrangler must report the `BACKEND` binding as connected,
and a temporary server-side caller running inside the real OpenNext request
context must call `smokeBackend()` and receive exactly:

```json
{ "status": "ok", "service": "api", "entrypoint": "rpc" }
```

Treat that first real adapter-to-RPC invocation as a mandatory gate. Do not
add a permanent public route or UI for the smoke call, and remove any temporary
caller before committing the Slice 1 consumer migration.

The Slice 1 local gate passed on 2026-07-30 after
`npx opennextjs-cloudflare build` in `apps/web`, followed from the repository
root by:

```bash
npx wrangler dev \
  -c apps/web/wrangler.jsonc \
  -c apps/api/wrangler.jsonc \
  --local --ip 127.0.0.1 --port 8799
```

No compatibility override was used: `web` used its configured `2026-07-01`
date and `api` used `2026-07-29`, both supported by Wrangler 4.114.0's bundled
runtime. Wrangler reported `BACKEND` (`api#WebAppApi`) as `[connected]`; a
temporary dynamic OpenNext Route Handler received exactly the sentinel above
and the API emitted an `entrypoint: "rpc"`, `event: "health"`, `status: 200`
structured log. The temporary handler and local processes were removed
immediately after the test; there is no committed smoke endpoint.

### Slice 2 RPC-versus-SQL staging comparison

The implementation environment did not have an approved staging database
credential or tenant fixture, so this comparison remains a manual, read-only
staging action. It must be completed before deploying the Slice 2 web
consumer.

1. Choose an approved tenant fixture with conversations on at least two Pages,
   more than 100 conversations in total, and a thread with more than 100
   messages.
2. Through the staging `web -> BACKEND -> WebAppApi` binding, collect every
   cursor page from `listConversations` with a limit of 100. Repeat with one
   active or disconnected Page filter. For the selected conversation, collect
   every cursor page from `getConversationThread`.
3. In a separate read-only SQL session, query the same tenant and Page filter.
   Compare only counts, stable IDs, Page IDs, directions, statuses, and
   timestamps. Conversation order must be
   `last_message_at desc, id desc`; message order from RPC must be reversed
   once after all pages are collected and then match
   `created_at asc, id asc`.
4. Confirm an absent or foreign conversation returns `not_found`, a Page
   filter cannot return another Page's conversations, and no result is
   truncated at 100.
5. Record pass/fail totals and timings only. Do not paste or log message text,
   contact IDs/names, provider responses, failure bodies, tokens, URLs with
   query strings, cookies, or database credentials.

Delete any temporary comparison caller after the check. Do not add an HTTP
fallback, dual-read path, or permanent debug route to perform this validation.

## Validate the Connections RPC cutover

The `/connections` list, selection, webhook URL update, disconnect,
signing-secret rotation, OAuth code exchange, and Meta user/Page token
persistence use the `BACKEND` Service Binding. Web retains only browser-facing
OAuth state/cookie and redirect handling. There is no SQL, provider-client, or
HTTP fallback in these paths.

In staging, verify with two tenants and active, token-invalid, unsigned, and
disconnected Pages:

1. A tenant sees only its Pages, with active/valid, active/invalid, then
   disconnected ordering. Raw provider token errors and encrypted credential
   fields must not appear in RSC payloads, HTML, browser logs, or analytics.
2. An unsigned Page cannot save a non-empty webhook URL. It can clear a legacy
   URL. HTTP, including localhost, is rejected in the form; use an HTTPS tunnel
   for development. The API remains authoritative for public-destination/SSRF
   validation.
3. Creating or rotating a signing secret requires confirmation. Copy the
   revealed value immediately: it is returned once in action state and must
   never enter a URL, cookie, hidden input, log, analytics event, or database
   plaintext. Rotation invalidates the previous secret.
4. Update and rotation against a foreign or disconnected Page return the same
   tenant-scoped `not_found` result and do not mutate it.
5. Disconnect requires confirmation, preserves history, and remains locally
   authoritative even if Meta unsubscribe fails.
6. A temporary product-shell failure hides only quota metadata while retaining
   the authoritative Page list. Access changes redirect to waitlist/billing;
   protocol or tenant mismatches fail closed.

## Validate the Settings RPC cutover

The Settings account/API-key reads and the API-key, password, and account
mutations use the `BACKEND` Service Binding exclusively. Slice 10 also moved
the deprecated public-send contract behind a raw web proxy to the private API
allowlist. Opaque API-key verification, hashing/pepper, quota, persistence and
the Meta side effect now run only in `apps/api`; web retains none of those
helpers.

In staging:

1. Confirm active and revoked API-key metadata stays ordered and tenant-scoped.
   Hashes, pepper, tenant persistence fields, and full keys must not cross the
   list/revoke DTOs.
2. Create a key and copy it immediately. The full value is returned only in
   Server Action state and must not enter URLs, cookies, hidden inputs, logs, or
   analytics.
3. Revoke a key from each tenant and verify foreign IDs return the same
   tenant-scoped not-found result without changing either tenant's history.
4. Change a password at the 8/1024-character boundaries and verify the current
   Auth.js session ends at `/login?passwordChanged=1` only after RPC success.
5. Test account deletion with a mismatched email, `deleted:false`, successful
   cleanup, and Meta/Stripe cleanup failures. Only `deleted:true` signs out.
   Operational records may contain the deletion boolean and cleanup
   count/boolean, never provider IDs, tokens, subscription IDs, or raw errors.

## Validate the Billing RPC cutover

The `/billing` Checkout action, `/billing/success` verification, Settings
subscription read, and Customer Portal action use the `BACKEND` Service Binding
exclusively. The API Worker is the only Stripe client for those flows and
builds every `/billing`, `/billing/success`, and `/settings` return path from an
exact `WEB_APP_ORIGINS` entry. The legacy web Stripe callback URL is retained as
a thin Service Binding proxy until the ordered callback cutover is complete;
it no longer owns subscription mirroring in the repository implementation.

In staging:

1. Set `APP_URL` to the exact web origin and confirm Checkout ignores request
   `Host`/forwarded-host values. The API must reject paths, credentials,
   arbitrary HTTPS origins, and an absent or malformed `WEB_APP_ORIGINS`.
2. Start monthly Starter and Pro Checkout Sessions. Confirm the lookup-key
   allowlist rejects any other plan, there is no trial, no
   `payment_method_types`, and `integration_identifier` matches
   `resender_[a-z]{8}`.
3. Confirm Checkout redirects only to `https://checkout.stripe.com` and Portal
   only to `https://billing.stripe.com`. Never copy these session URLs into
   logs, analytics, cookies, tickets, or persistent browser storage.
4. Test waitlisted, deleted, unsubscribed, and active tenants. Portal requires
   an active subscription even if a Stripe customer mapping exists; a missing
   customer returns the safe billing path without exposing the customer ID.
5. Return through `/billing/success` with missing, malformed, foreign, open,
   and complete `cs_test_`/`cs_live_` sessions. Only an owned complete session
   renders the activation wait. It never grants access: only the signed Stripe
   webhook may write the active subscription state.
6. Inspect RPC/RSC/Action payloads and operational logs. Customer IDs,
   subscription IDs, Stripe keys, raw provider errors, and Checkout session IDs
   must not appear. Provider and binding failures must stay sanitized and fail
   closed.

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

Repeat with `--env staging`. `AUTH_SECRET` remains shared for credential
compatibility; all API-key hashing and `TOKEN_ENCRYPTION_KEY` use is API-owned.
Use a direct Neon URL only for the API-owned schema migration runner and the
approved pooled runtime URL for the Worker.

## Remove backend secret names from web (manual gate — NOT EXECUTED)

This is an explicit post-cutover operation. Repository examples and generated
web bindings are already limited to web-owned configuration, but deployed
Worker secrets and ignored local files are external state. No production,
staging, or local secret was deleted or edited while implementing this
checkpoint.

The backend-only names to remove from the `web` Worker in both root production
and staging are:

```text
API_KEY_PEPPER
DATABASE_URL
TOKEN_ENCRYPTION_KEY
META_APP_SECRET
META_VERIFY_TOKEN
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
META_APP_ID
```

`META_APP_ID` in this list means the private API binding; the presentational
`NEXT_PUBLIC_META_APP_ID` remains web-owned. Keep `AUTH_SECRET`, `APP_URL`, all
required `NEXT_PUBLIC_*` values, and other explicitly presentational web
configuration.

First inventory names only. `wrangler secret list` reports secret metadata and
names; do not print, copy, log, or compare secret values:

```bash
cd apps/web
npx wrangler secret list --env=""
npx wrangler secret list --env staging
```

Do not run `wrangler secret delete` until all of these gates are recorded:

1. Database migrations have completed from `apps/api`.
2. The API Worker has deployed and both `/healthz` and `/readyz` pass.
3. The web Worker with its `BACKEND` binding has deployed after the API.
4. Legacy send plus Meta/Stripe callback proxy smokes pass through the binding
   with the expected status/body and exactly one API-owned side effect.
5. The approved callback/client cutover has remained stable for its observation
   window and rollback does not require restoring web domain ownership.
6. An operator has reviewed the root and staging name inventories and obtained
   explicit approval for the exact deletions.

After those gates, delete only the listed names, one at a time, from root and
staging with `wrangler secret delete`; never use a bulk wildcard or paste
values into the command, log, or ticket. Re-run `wrangler secret list` for both
environments and record only the presence/absence of names.

Local development needs the same ownership cleanup. The ignored
`apps/web/.env` may still contain legacy backend names even though repository
examples no longer do. Review it locally without printing or sharing values,
remove only the backend-only names above, and keep `AUTH_SECRET`, `APP_URL`,
and required `NEXT_PUBLIC_*`/presentational entries. Move API values to the
ignored API-local environment file through the approved secret channel; never
copy their values into documentation, shell output, CI logs, or a commit.

## Callback proxy cutover (not executed)

This sequence is an operational gate, not a record of completed work. Preserve
the order so a provider event has exactly one domain owner throughout the
cutover:

1. Deploy the API Worker version that owns `GET` and `POST /webhooks/meta` and
   `POST /webhooks/stripe`.
2. Smoke the API endpoints directly with a controlled Meta challenge and
   controlled signed Meta and Stripe fixtures. Alter one byte and each
   signature to confirm rejection. Verify each accepted event creates exactly
   one expected side effect.
3. Deploy the web Worker version whose legacy callback handlers proxy the raw
   request through `BACKEND`. A missing or failed binding must return the fixed
   `503` so providers retry.
4. Smoke the legacy web callback URLs end to end: repeat the Meta challenge and
   signed Meta/Stripe fixtures, confirm API status/headers/body pass through,
   and confirm there is still exactly one domain side effect with no local web
   write or provider call.
5. Manually update the Meta App Dashboard callback and Stripe webhook endpoint
   only after the API and proxy evidence above passes. Record the exact
   environment, UTC time, operator, and sanitized result; never record
   challenge tokens, signatures, raw bodies, or provider secrets.
6. Observe API callback status/latency, signature failures, Queue backlog,
   retries, DLQ, deduplication, and database effects for the approved window.
   Confirm provider retries do not create duplicate messages, subscriptions,
   or outbound jobs.
7. Disable the old provider-dashboard endpoints only after the observation
   evidence is approved. Keep the legacy web proxy code available for the
   agreed rollback window; do not remove the legacy send path in this slice.

No Meta/Stripe Dashboard, DNS, secret, Worker deployment, or old-endpoint
change was performed as part of this checkpoint.

## Validate before deployment

```bash
npm --workspace @workspace/contracts run typecheck -- --incremental false
npm --workspace @workspace/ui run typecheck -- --incremental false
npm --workspace api run cf-typegen:check
npm --workspace web run cf-typegen:check
npm --workspace api run lint
npm --workspace web run lint
npm --workspace api run typecheck -- --incremental false
npm --workspace web run typecheck -- --incremental false
npm --workspace api run test:run
npm --workspace web run test:run
npm --workspace api run build
npm --workspace web run build
npm --workspace web exec -- opennextjs-cloudflare build
npx wrangler deploy --dry-run --env="" -c apps/web/wrangler.jsonc
npx wrangler deploy --dry-run --env staging -c apps/api/wrangler.jsonc
npx wrangler deploy --dry-run --env staging -c apps/web/wrangler.jsonc
```

The API `build` script and all Wrangler commands with `--dry-run` only package
their Workers. The web `build` and OpenNext commands compile and package the
frontend. None of these commands deploys a Worker.

### Integrated local acceptance server

`npm run dev` is the full local acceptance server. Turbo starts the Next
development server on port `3000` and the Wrangler API Worker on port `8787`.
The web task waits, with a 20-second deadline and bounded retries, until
Wrangler has registered a live local Worker named `api`; only then does it
start `next dev`. OpenNext's `initOpenNextCloudflareForDev()` reads
`apps/web/wrangler.jsonc`, so `BACKEND` resolves by Worker name to
`api#WebAppApi`. Application traffic has no HTTP fallback to port `8787` or to
the public API hostname.

```bash
npm run dev
```

In another terminal, verify Next and all three binding-backed compatibility
proxies:

```bash
curl --fail --show-error --silent http://localhost:3000/ > /dev/null
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST --header 'content-type: application/json' --data '{}' \
  http://localhost:3000/api/meta/send)" = "401"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST --header 'content-type: application/json' \
  --header 'x-hub-signature-256: invalid-smoke-signature' --data '{}' \
  http://localhost:3000/api/meta/webhook)" = "400"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST --header 'content-type: application/json' \
  --header 'stripe-signature: invalid-smoke-signature' --data '{}' \
  http://localhost:3000/api/stripe/webhook)" = "400"
```

The compatibility proxy results cover Next -> `BACKEND` ->
`WebAppApi.fetch`. When an RPC consumer changes, also exercise it through its
real server-rendered page or a temporary server-only caller as described in
the Slice 1 gate, then remove the temporary caller. Next retains Hot Module
Replacement in this topology, so normal web source changes do not require
rebuilding OpenNext or restarting the root command. Restart after changing
Wrangler configuration or binding names.

## Custom domains: declared configuration and external activation

The source of truth in Wrangler declares exactly these custom-domain routes:

| Environment | Worker        | Declarative route          |
| ----------- | ------------- | -------------------------- |
| production  | `api`         | `api.resender.dev`         |
| production  | `web`         | `resender.dev`             |
| staging     | `api-staging` | `api-staging.resender.dev` |
| staging     | `web-staging` | `staging.resender.dev`     |

Every route is an object with `custom_domain: true`. The staging web
`BACKEND` remains bound to `api-staging#WebAppApi`; production remains bound to
`api#WebAppApi`. Declaring these values in git does not activate a route,
change DNS, deploy a Worker, or prove TLS readiness.

For each of the four hostnames, perform and record this procedure separately:

1. Confirm the `resender.dev` zone is **Active** in Cloudflare and that
   authoritative NS lookup returns the Cloudflare nameservers:

   ```bash
   dig NS resender.dev +short
   ```

2. Confirm the hostname is free before deployment. Inspect Cloudflare DNS and
   **Workers & Pages → Domains & Routes** for an existing DNS record, custom
   domain, or Worker route using the exact hostname. Cross-check without
   mutation:

   ```bash
   dig A api.resender.dev +short
   dig AAAA api.resender.dev +short
   dig CNAME api.resender.dev +short
   ```

   Repeat for `api-staging.resender.dev`, `resender.dev`, and
   `staging.resender.dev`. Do not delete or overwrite an unknown owner; resolve
   the conflict first.

3. Validate the repository config and package without account mutation:

   ```bash
   npm --workspace api run cf-typegen:check
   npm --workspace web run cf-typegen:check
   npx wrangler deploy --dry-run --env="" -c apps/api/wrangler.jsonc
   npx wrangler deploy --dry-run --env staging -c apps/api/wrangler.jsonc
   npx wrangler deploy --dry-run --env="" -c apps/web/wrangler.jsonc
   npx wrangler deploy --dry-run --env staging -c apps/web/wrangler.jsonc
   ```

4. Only after approval, deploy in API-first order. Wrangler then reconciles the
   declared custom domain with the Cloudflare account. Do not also create a
   competing dashboard route.
5. After each deploy, wait for Cloudflare to show the custom domain as active
   with a valid certificate. Verify authoritative DNS, TLS hostname validation,
   and the expected endpoint:

   ```bash
   dig api-staging.resender.dev +short
   curl --fail --show-error --silent https://api-staging.resender.dev/healthz
   curl --fail --show-error --silent https://api-staging.resender.dev/readyz
   curl --fail --show-error --silent https://staging.resender.dev/ > /dev/null
   ```

   Repeat against `api.resender.dev` and `resender.dev` for production. A DNS
   answer alone is insufficient; both HTTPS requests and certificate hostname
   validation must succeed.

No custom-domain, DNS, TLS, Worker deployment, or Cloudflare-account action in
this section was executed while implementing the repository configuration.

## Staging deployment and smoke sequence

After the resources and secrets exist:

```bash
npm --workspace api run deploy:staging
curl --fail --show-error --silent --retry 5 --retry-all-errors \
  https://api-staging.resender.dev/readyz
APP_URL=https://staging.resender.dev npm --workspace web run deploy:staging
curl --fail --show-error --silent --retry 5 --retry-all-errors \
  https://staging.resender.dev/ > /dev/null
```

The web build consumes `APP_URL`, `NEXT_PUBLIC_META_APP_ID`,
`NEXT_PUBLIC_META_CONFIG_ID`, `NEXT_PUBLIC_POSTHOG_KEY`, and
`NEXT_PUBLIC_POSTHOG_HOST` at build time. Supply the approved staging values in
the operator environment before the web command; do not rely on production
values or an ignored `.env`. `APP_URL` must be exactly
`https://staging.resender.dev`. The `NEXT_PUBLIC_*` values are intentionally
public but still must come from the approved staging configuration. OpenNext
build itself is environment-neutral and receives no `--env`; only the deploy
step selects the Wrangler environment with `--env staging`.

Then smoke-test staging in a browser and through the binding:

- `GET /healthz` returns `200`.
- `GET /readyz` returns `200` without exposing dependency details.
- `/openapi.json` and `/openapi/download` contain the same document.
- `/docs` loads Swagger UI from `/openapi.json`.
- `WEB_APP_ORIGINS` accepts only the approved staging origin; the production
  origin and arbitrary HTTPS origins are rejected.
- The repository's `BACKEND` Service Binding resolves to the staging API's
  `WebAppApi` entrypoint after both Workers are deployed.
- Log in through `https://staging.resender.dev`, open Connections, Messages,
  Billing, and Settings, and complete a read-only action on each RPC-backed
  screen. A binding failure or HTTP fallback is a failure.
- An unauthenticated `POST /api/meta/send` returns `401`; an invalid signed
  `POST /api/meta/webhook` returns `400`. These exercise the web-to-API proxy
  route without creating a provider side effect.
- An absent, malformed, and revoked API key each fail without exposing tenant
  data.
- A controlled Meta/Stripe test signature is accepted; an altered raw body is
  rejected.
- A test inbound event produces one job and a duplicate does not produce a
  second message.
- Delivery outcomes cover 2xx, 408, 429, permanent 4xx, 5xx, timeout, retry,
  and DLQ.

Only after staging evidence is approved, production order is fixed. Root
production is selected explicitly with `--env=""`; named staging uses
`--env staging`:

```bash
npm --workspace api run db:migrate
npm --workspace api run deploy
# smoke https://api.resender.dev/healthz
npm --workspace web run deploy
# smoke https://resender.dev and an invalid callback signature through BACKEND
```

Creating or deploying the API Worker is not authorization to change DNS, the
Meta callback, the Stripe webhook endpoint, or deploy the updated `web` Worker
configuration. Those cutovers remain manual.

Production deploys never run on merge. `.github/workflows/deploy.yml` accepts
only a manual `workflow_dispatch` from `refs/heads/main` with the exact
confirmation `DEPLOY_PRODUCTION`, and the job uses the GitHub `production`
environment. Before the first run, Arturo must configure **required reviewers**
for that environment in GitHub repository settings. The confirmation string is
not a substitute for environment approval.

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

For staging, roll back web first, verify the browser and proxy smokes against
the previous compatible API, then roll back API only if required:

```bash
npx wrangler rollback --env staging -c apps/web/wrangler.jsonc
npx wrangler rollback --env staging -c apps/api/wrangler.jsonc
```

For production, use the same order with `--env=""` under the production
environment approval. Record the selected version IDs and sanitized smoke
results. Do not detach custom domains or rewrite DNS during an application
rollback unless the incident is specifically a domain-routing failure and the
previous route owner is known.

Before the callback cutover is recorded, provider traffic is assumed to point
at `web`, so the remaining rollback is limited:

1. Stop test traffic to `api`.
2. Roll back the `api` Worker version in Cloudflare.
3. Leave migration `0010` in place; it is additive and compatible with legacy
   `web` inserts.
4. Do not purge the Queue or DLQ. Inspect and reconcile jobs using the DLQ
   runbook.

After dashboard cutover, first repoint the affected provider dashboard to the
last verified legacy web proxy endpoint, then confirm `BACKEND` reaches the
last healthy API version. Do not re-enable removed web domain logic or point
both provider endpoints at independent receivers; either can produce duplicate
side effects.

The source files `docs/domain.md` and `prd_api_separation.md` referenced by the
planning document were absent. `CONTEXT.md`, migrations `0001`–`0009`, current
production code, and `docs/phase-1-api-migration.md` were used as the canonical
inputs.
