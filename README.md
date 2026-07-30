# Resender

Resender is a Messenger gateway and durable log for external automations.

## Public API v1

The production API base URL is `https://api.resender.dev`. Its canonical
references are:

- Swagger UI: <https://api.resender.dev/docs>
- OpenAPI JSON: <https://api.resender.dev/openapi.json>
- Downloadable OpenAPI: <https://api.resender.dev/openapi/download>
- Migration and webhook guide: [`docs/api-v1-guide.md`](docs/api-v1-guide.md)

Send a text message with an internal Resender Page UUID and a required
idempotency key:

```bash
curl -X POST https://api.resender.dev/v1/messages \
  -H "Authorization: Bearer pk_live_..." \
  -H "Idempotency-Key: order-42-confirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
    "recipientId": "page-scoped-psid",
    "type": "text",
    "text": "Your order is ready"
  }'
```

Customer webhook delivery is at least once. Verify `Resender-Signature` over
`<eventId>.<timestamp>.<rawJsonBody>` and deduplicate with
`Resender-Event-Id`. Retry and DLQ behavior is documented in the guide above
and in [`docs/api-dlq-runbook.md`](docs/api-dlq-runbook.md).

The old `POST https://resender.dev/api/meta/send` endpoint is deprecated.
There is no approved retirement date; the operational approval placeholders
and removal gates are maintained in the migration guide.

## MVP environment

`apps/web` expects these variables for the MVP stack:

```bash
APP_URL="https://your-public-origin.example"
AUTH_SECRET="generate-a-long-random-secret"
API_KEY_PEPPER="optional-separate-api-key-pepper"
DATABASE_URL="postgres://user:password@host:5432/db"
TOKEN_ENCRYPTION_KEY="generate-with-openssl-rand-hex-32"
META_APP_SECRET="meta-app-secret"
META_VERIFY_TOKEN="meta-webhook-verify-token"
NEXT_PUBLIC_META_APP_ID="meta-app-id"
NEXT_PUBLIC_META_CONFIG_ID="meta-login-config-id"
STRIPE_SECRET_KEY="rk_test_your-stripe-restricted-key"
STRIPE_WEBHOOK_SECRET="whsec_your-stripe-webhook-signing-secret"
```

`STRIPE_SECRET_KEY` should be a restricted API key (`rk_…`, Dashboard →
Developers → API keys → Create restricted key) with only: Customers (write),
Checkout Sessions (write), Prices (read), Subscriptions (write), Customer
portal (write), Invoices (read), Refunds (write). A full secret key (`sk_…`)
works but is discouraged.

`STRIPE_WEBHOOK_SECRET` comes from `stripe listen` in development (see the
Stripe CLI) or from the webhook endpoint's signing secret in production.

Run database migrations manually after setting `DATABASE_URL`:

```bash
npm --workspace web run db:migrate
```

Generate `TOKEN_ENCRYPTION_KEY` with:

```bash
openssl rand -hex 32
```

## Validation

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## Adding components

To add components to your app, run the following command at the root of the repo:

```bash
npm exec shadcn@latest add button -c apps/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Using components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@workspace/ui/components/button";
```
Cambio lori
