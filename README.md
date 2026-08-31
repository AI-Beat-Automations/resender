# Resender

Resender is a Meta messaging gateway and durable log for external automations.

## Channels

Two channels, discriminated by `connected_pages.channel`:

| | `messenger` | `instagram` |
|---|---|---|
| What connects | a Facebook Page | an Instagram professional account |
| Login | Facebook Login for Business (permissions live in a `config_id`) | Instagram Login (`graph.instagram.com`, explicit `scope`, no Facebook Page needed) |
| Surfaces | DMs | DMs **and** comments on posts |
| Token | does not expire | ~60 days, needs refreshing |
| Webhook signature | `META_APP_SECRET` | `INSTAGRAM_APP_SECRET` |
| Counts against plan quota / page limit | yes | not for now |

Instagram routes are the Facebook ones with `/instagram` inserted:
`/api/meta/instagram/{start,callback,webhook,send}` plus
`/api/meta/instagram/comments/{reply,private-reply}` in `web`, and
`/webhooks/meta/instagram` plus the `/v1/comments` resource in `api`.

Background reading: `docs/adr/0008-instagram-como-segundo-canal.md` for the
decision and its trade-offs, `prd_instagram.md` for the built behaviour and the
Meta dashboard setup, `CONTEXT.md` for the canonical product vocabulary.

## MVP environment

`apps/web` expects these variables for the MVP stack:

```bash
APP_URL="https://your-public-origin.example"
# Sesión y credenciales (Better Auth, ADR 0014).
BETTER_AUTH_SECRET="generate-a-long-random-secret"
BETTER_AUTH_URL="https://your-public-origin.example"
DATABASE_URL="postgres://user:password@host:5432/db"
TOKEN_ENCRYPTION_KEY="generate-with-openssl-rand-hex-32"
META_APP_SECRET="meta-app-secret"
META_VERIFY_TOKEN="meta-webhook-verify-token"
NEXT_PUBLIC_META_APP_ID="meta-app-id"
NEXT_PUBLIC_META_CONFIG_ID="meta-login-config-id"
INSTAGRAM_APP_ID="instagram-app-id"
INSTAGRAM_APP_SECRET="instagram-app-secret"
INSTAGRAM_VERIFY_TOKEN="instagram-webhook-verify-token"
STRIPE_SECRET_KEY="rk_test_your-stripe-restricted-key"
STRIPE_WEBHOOK_SECRET="whsec_your-stripe-webhook-signing-secret"
```

The three `INSTAGRAM_*` variables come from the Meta app's Instagram product
(**Instagram → API setup with Instagram login**), not from Facebook Login.
`INSTAGRAM_APP_SECRET` is a **different value** than `META_APP_SECRET`: it signs
the Instagram webhook and doubles as the OAuth `client_secret`. Signing an
Instagram webhook with the Facebook secret is the most common misconfiguration
here, which is why Instagram has its own webhook route in both workers —
`/api/meta/instagram/webhook` in `web` and `/webhooks/meta/instagram` in `api` —
instead of sharing the Facebook one. Register both routes separately in the Meta
app, each with its own verify token, subscribed to the `messages` and `comments`
fields.

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

Migrations live in `apps/web/db/migrations` and run before every deploy. `0013_instagram_channel.sql`
replaces the global unique on `connected_pages.meta_page_id` with `(channel, meta_page_id)`
and makes the delivery tables accept a message **or** a comment, so both workers must be
deployed together with it — an `on conflict` or `join` pinned to the old constraints fails
at runtime.

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