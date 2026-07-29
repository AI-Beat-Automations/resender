# PostHog Audit Report

## Summary

This audit covers the server-side PostHog integration (`posthog-node`) in a Next.js App Router application. The SDK is installed and up to date, initialization is correct, and all three growth-funnel events are tracked — but two errors need attention: logout flows do not call `posthog.reset()` (risking identity merges across users on shared devices), and one event name is built dynamically via a ternary expression (breaking event-name consistency in funnels).

**Counts**

- **Errors**: 2 (must fix)
- **Warnings**: 0 (should fix)
- **Suggestions**: 0 (nice to have)
- **Passes**: 8

**Problematic items** _(only `error`, `warning`, `suggestion` — no passes)_

| Severity | Area | Check | File | Details |
|----------|------|-------|------|---------|
| `error` | Identification | reset() called on logout / account switch | `apps/web/app/(product)/layout.tsx:37` | signOutAction and two other signOut calls never call posthog.reset() |
| `error` | Event Capture | Event names are static and consistent | `apps/web/app/api/stripe/webhook/route.ts:130` | Event name uses a ternary expression instead of a static string literal |

## Recommended actions

1. **Identification · reset() called on logout / account switch** — Three logout paths (`signOutAction` in `apps/web/app/(product)/layout.tsx:37`, and two calls in `apps/web/features/account/actions.ts`) call NextAuth `signOut()` without ever calling `posthog.reset()`. _Why it matters:_ Without a reset, the browser retains the PostHog anonymous ID from the previous authenticated session; when a second user logs in on the same device, the subsequent `identify()` call can merge both users into a single PostHog person, corrupting person counts, retention reports, and experiment cohorts. _Fix:_ Add a client-side `posthog.reset()` call (from `posthog-js`) before or after the signOut redirect at each logout site — or, since this is currently a server-only integration, add `posthog-js` for client-side session management and call `posthog.reset()` in the client logout handler. See [PostHog identify docs](https://posthog.com/docs/product-analytics/identify).

2. **Event Capture · Event names are static and consistent** — At `apps/web/app/api/stripe/webhook/route.ts:130`, the event name is computed via a ternary: `isCanceled ? "subscription canceled" : "subscription started"` rather than two separate `posthog.capture()` calls with static string literals. _Why it matters:_ Dynamic event names cannot be reliably typed, auto-completed, or cross-referenced in PostHog's event taxonomy; they also break funnel definitions and any tooling that validates event names statically. _Fix:_ Split the single `capture()` call into two branches — one calling `posthog.capture("subscription canceled", …)` and one calling `posthog.capture("subscription started", …)` — at `apps/web/app/api/stripe/webhook/route.ts:130`. See [PostHog capture docs](https://posthog.com/docs/product-analytics/capture-events).

## Full audit

### Installation

These checks verify that a PostHog SDK is present in the dependency manifest, that the installed version is current, and that the SDK is initialized correctly (env-sourced token, appropriate runtime, no duplicate inits).

| Check | Status | File | Details |
|-------|--------|------|---------|
| PostHog SDK installed | pass | apps/web/package.json | posthog-node@5.46.1 in apps/web/package.json |
| SDK version up to date | pass | | installed 5.46.1, latest 5.46.1 |
| Initialization is correct | pass | apps/web/lib/posthog.ts:15 | posthog-node singleton, env-sourced NEXT_PUBLIC_POSTHOG_KEY, flushAt:1/flushInterval:0, single init site |

#### Assumptions and blind spots

Only `apps/web/package.json` was checked for PostHog SDK references; no other sub-packages in the monorepo appear to use PostHog independently. The `.env` file was confirmed to contain `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`, but their actual values were not read — runtime misconfiguration (wrong project token, wrong host) would not be caught by this static check. The audit assumes the singleton in `lib/posthog.ts` is imported everywhere PostHog is used; any ad-hoc `new PostHog()` calls elsewhere would be separate inits not reflected here. Verify in PostHog that events are arriving on the expected project to confirm the token is wired correctly.

### Identification

These checks verify that `identify()` uses a stable user ID, is called before any captures or flag evaluations for that user, that client and server runtimes share the same `distinct_id`, and that logout / account-switch flows call `posthog.reset()`.

| Check | Status | File | Details |
|-------|--------|------|---------|
| Stable distinct_id (not session UUID) | pass | apps/web/auth.ts:32 | distinctId is set to user.id (database user ID from authenticated user object) in both auth.ts and features/auth/actions.ts — stable, not session/device-based. |
| identify() called before captures / flag evals | pass | apps/web/auth.ts:31 | identify() is called immediately before capture() inside the authorize callback at login — no captures or flag evals can fire for an identified user before identity is established. |
| Same distinct_id across client and server | pass | apps/web/lib/posthog.ts:15 | Single runtime only — posthog-node is initialized server-side; no posthog-js client runtime exists in the codebase, so cross-runtime distinct_id alignment is not applicable. |
| reset() called on logout / account switch | **error** | apps/web/app/(product)/layout.tsx:37 | signOutAction (and the two other signOut calls in actions.ts) are server-side NextAuth actions that never call posthog.reset(), so the browser retains the identified session and the next user who logs in on the same device may be merged with the previous one. |

#### Assumptions and blind spots

The audit found three logout paths (`signOutAction` in `layout.tsx`, `changePasswordAction` and `deleteAccountAction` in `features/account/actions.ts`) — there may be additional logout triggers (e.g. OAuth token expiry, forced signout via admin) that were not detected by static grep. The `cross-runtime-distinct-id` check passed because no `posthog-js` browser init was found; if client-side PostHog is added in the future, distinct_id hand-off between server and browser must be re-audited. Verify in PostHog's "Persons" view that no duplicate person merges appear after user account switches to confirm the impact of the reset() gap.

### Event Capture

These checks verify that event names are static strings, that browser captures route through a reverse proxy, and that key growth-funnel events (signup, activation, purchase/subscription) are explicitly captured.

| Check | Status | File | Details |
|-------|--------|------|---------|
| Event names are static and consistent | **error** | apps/web/app/api/stripe/webhook/route.ts:130 | Event name uses a ternary expression (`isCanceled ? "subscription canceled" : "subscription started"`), not a static string literal. |
| Captures route through a reverse proxy | pass | apps/web/lib/posthog.ts:15 | Server-only SDK (posthog-node); no browser runtime initializes PostHog, so a reverse proxy is not needed to bypass ad/tracking blockers. |
| Key activation events captured | pass | apps/web/features/auth/actions.ts:87 | Signup ('user registered'), activation ('api key created'), and subscription ('subscription started' / 'checkout completed') are all explicitly captured via posthog.capture. |

#### Assumptions and blind spots

The dynamic event name in the Stripe webhook (`isCanceled ? "subscription canceled" : "subscription started"`) means PostHog receives the correct string at runtime — the data-quality problem is that tooling (type checks, funnel builders, event taxonomy) cannot statically verify the names. The `capture-uses-proxy` skip is correct today but should be revisited if `posthog-js` is added for client-side analytics. The growth-events check relied on grep for signup/subscribe patterns; any growth-critical events using unconventional naming (e.g. a checkout page named "upgrade") would not have been found. Verify in PostHog's Events view that `user registered`, `api key created`, `subscription started`, and `checkout completed` all have the expected volumes.

## About this audit

The PostHog wizard runs a five-stage chain: SDK installation → init correctness → identification → event capture → this report. Each stage resolves one or more checks against the project's source tree, recording every result — pass or otherwise — in the ledger this report was generated from.

- `error` items break correctness now (events lost, identity broken). Fix first.
- `warning` items work today but cause subtle data-quality bugs. Fix when convenient.
- `suggestion` items are best-practice improvements with measurable upside.

Re-run `posthog-wizard audit` after applying fixes to refresh the ledger.
