# API webhook DLQ runbook

Queue: `webhook-deliveries-dlq` (production) or
`webhook-deliveries-staging-dlq` (staging).

The DLQ consumer marks the corresponding `external_webhook_jobs` row `dead`
and only then acknowledges the Queue message. If that database write fails,
the message is explicitly retried; both production and staging DLQ consumers
retain non-zero Queue retries. It never calls the customer webhook.

## Triage

1. Identify the environment and incident window.
2. Inspect structured logs for `event=webhook_delivery_dead`; correlate
   `jobId` and `messageId`.
3. Query only stable metadata from:
   - `external_webhook_jobs`: status, attempt count, last status/error, URL
     host, timestamps.
   - `external_webhook_deliveries`: attempt, status code, error, timestamp.
4. Do not copy payloads, message text, signing secrets, or access tokens into
   chat, tickets, or logs.
5. Determine the class:
   - Customer endpoint outage/timeouts/429/5xx.
   - Invalid or rotated customer endpoint.
   - Blocked/private DNS result.
   - Missing signing configuration.
   - Internal database or Worker failure.

## Remediation

- For a customer outage, wait for explicit confirmation that the endpoint is
  healthy.
- For URL or DNS policy failures, require the customer to configure a public
  HTTPS/default-port endpoint. Never bypass the SSRF guard.
- For a missing signing secret, rotate it through the authenticated API and
  deliver the one-time value securely to the customer.
- For internal failures, deploy a reviewed fix before replay.

## Controlled replay

There is no automatic bulk replay in phase 1. To replay a reviewed job:

1. Confirm the job belongs to the intended tenant and has not succeeded.
2. Confirm its snapshot URL and payload are still appropriate.
3. In one transaction, set that exact job ID from `dead` to `pending`, clear
   only transient last-error fields, set `recover_after` to a reviewed future
   handoff deadline, and update `updated_at`.
4. Publish exactly `{ "jobId": "...", "messageId": "..." }` to the primary
   environment Queue.
5. Observe a new append-only delivery row and a terminal job status.

Use an explicit job ID; never run an unbounded status update. Because delivery
is at least once, the customer must deduplicate with `Resender-Event-Id`.

## Forbidden actions

- Do not purge either Queue as a first response.
- Do not replay an entire DLQ without tenant-by-tenant review.
- Do not mark a job `succeeded` manually.
- Do not edit payload JSON, event ID, or message ID in place.
- Do not disable signature verification, SSRF checks, or redirect blocking.
