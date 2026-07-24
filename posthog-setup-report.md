<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep server-side integration of PostHog into Resender using the `posthog-node` SDK. A shared singleton client was created at `apps/web/lib/posthog.ts` and wired into 9 files across authentication, billing, messaging, and API key management flows. User identity is established on every login and registration, and exceptions are captured in the Meta OAuth callback. All captures use `await posthog.flush()` so events are reliably sent from Next.js short-lived route handlers and server actions.

| Event name | Description | File |
|---|---|---|
| `user registered` | A new user account was successfully created. | `apps/web/features/auth/actions.ts` |
| `user logged in` | A user successfully authenticated with their credentials. | `apps/web/auth.ts` |
| `page connected` | A Facebook Page was authorized and connected to the tenant's account. | `apps/web/app/api/meta/callback/route.ts` |
| `page disconnected` | A connected Facebook Page was disconnected from the tenant's account. | `apps/web/features/connections/actions.ts` |
| `webhook url saved` | A customer webhook URL was configured for a connected page. | `apps/web/features/connections/actions.ts` |
| `message sent` | An outbound message was sent to a Meta contact via the API. | `apps/web/app/api/meta/send/route.ts` |
| `message received` | An inbound message was received from a Meta contact and persisted. | `apps/web/lib/inbound/inbound-ingestion.ts` |
| `message delivery failed` | Forwarding an inbound message to the customer's webhook URL failed. | `apps/web/lib/inbound/external-push.ts` |
| `api key created` | A new API key was generated for a tenant. | `apps/web/features/api-keys/actions.ts` |
| `api key revoked` | An existing API key was revoked and can no longer be used. | `apps/web/features/api-keys/actions.ts` |
| `subscription started` | A Stripe subscription was created for a tenant. | `apps/web/app/api/stripe/webhook/route.ts` |
| `subscription canceled` | A Stripe subscription was canceled for a tenant. | `apps/web/app/api/stripe/webhook/route.ts` |
| `checkout completed` | A Stripe checkout session was completed and the customer was linked. | `apps/web/app/api/stripe/webhook/route.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/526148/dashboard/1897864)
- [Activation funnel (wizard)](https://us.posthog.com/project/526148/insights/sc81TlnJ) — Registration → page connected → webhook saved → first message sent
- [Messages volume (wizard)](https://us.posthog.com/project/526148/insights/uat0UDll) — Inbound vs outbound messages over time
- [Subscription activity (wizard)](https://us.posthog.com/project/526148/insights/YHeVcaZJ) — New and canceled subscriptions, and checkout completions
- [Delivery failure rate (wizard)](https://us.posthog.com/project/526148/insights/2jIMPoE8) — Webhook delivery failures vs messages sent
- [New registrations (wizard)](https://us.posthog.com/project/526148/insights/11lW7AdK) — Registrations, page connections, and API key creation over time

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` to `.env.example` and any monorepo bootstrap scripts so collaborators know what to set.
- [ ] Confirm the returning-visitor path also calls `identify` — a handler that only identifies on fresh login can leave returning sessions on anonymous distinct IDs.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] PostgreSQL and Stripe data sources were found in this project. Run `npx @posthog/wizard warehouse` to connect them to PostHog's data warehouse for richer analytics.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
