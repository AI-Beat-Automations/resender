# Resender public API v1

Production base URL: `https://api.resender.dev`.

Canonical reference:

- Interactive Swagger UI: <https://api.resender.dev/docs>
- OpenAPI JSON: <https://api.resender.dev/openapi.json>
- OpenAPI download: <https://api.resender.dev/openapi/download>

The three URLs describe the same OpenAPI 3.1 document. This repository guide
is the migration and operational companion; the OpenAPI document remains the
authority for request and response schemas.

## Quickstart: send a text message

Create an API key in Resender and obtain the internal Page UUID from
`GET /v1/pages`. Use the Page object's `id`, not its `providerPageId`.

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

`Idempotency-Key` is required, must contain 1–200 characters, and should
identify one logical send. Reuse the same key and body when the client did not
receive a response and cannot know whether the request completed. The replay
returns the stored result without another Meta call or quota charge. Reusing
the key with a different body returns `409 idempotency_conflict`.

A new accepted message returns `201`. An idempotent replay returns `200` with
`Idempotent-Replayed: true`. The API does not automatically retry an outbound
Meta send. A `422` or `502` response whose error
`details` includes `messageId` identifies a persisted provider attempt and a
completed idempotency key. Repeating that key returns the stored failed result
and does not call Meta again. If the caller intentionally wants a new provider
attempt after that response, it must send a new logical request with a new
`Idempotency-Key`. A pre-Meta error without `details.messageId` did not reserve
or complete the key; it is not evidence of a persisted provider attempt.

## Customer webhook delivery

Resender persists an inbound Meta message and its delivery job before
publishing the job to Cloudflare Queues. Customer webhook delivery is
**at least once**: the same logical event can be delivered more than once.
Receivers must store `Resender-Event-Id` and make processing idempotent.

Every request contains:

```text
Content-Type: application/json
Resender-Event-Id: evt_...
Resender-Timestamp: 1785348000
Resender-Signature: v1=<hex-hmac-sha256>
```

The signed value is:

```text
<eventId>.<timestamp>.<rawJsonBody>
```

Verify `Resender-Signature` with HMAC-SHA256 and the Page's current
`whsec_...` signing secret. Use the raw request bytes, validate the timestamp
against the receiver's replay window, and compare the expected signature in
constant time. Do not parse and reserialize JSON before verification.

Rotate a Page secret with
`POST /v1/pages/{pageId}/webhook-secret/rotate`. The plaintext secret is
returned only by that rotation response; store it immediately in the webhook
receiver's secret manager. Rotation invalidates the previous secret.

Delivery policy:

- `2xx`: success.
- `408`, `429`, `5xx`, timeout, or network failure: persist the failed attempt
  and retry with bounded delays.
- Any other non-`2xx` response, including `3xx` and other `4xx`: permanent
  failure; no retry.
- Exhausted retries: move the Queue message to the environment DLQ and mark
  the durable job dead when the DLQ consumer handles it.

Each attempt is visible through
`GET /v1/messages/{messageId}/deliveries`. Webhook retries are delivery
attempts for one stored event; they do not create or bill another message.

## Migrate from the legacy send endpoint

Legacy endpoint:

```text
POST https://resender.dev/api/meta/send
```

Replacement:

```text
POST https://api.resender.dev/v1/messages
```

Migration mapping:

| Legacy | API v1 |
| --- | --- |
| `pageId`: Meta Page ID | `pageId`: internal Resender Page UUID |
| `reply` | `text` |
| Implicit text message | Required `"type": "text"` |
| Optional `Idempotency-Key` | Required `Idempotency-Key` |
| Legacy response envelope | Public `Message` DTO under `{ "data": ... }` |

Migration procedure:

1. Call `GET https://api.resender.dev/v1/pages` with the tenant API key.
2. Match the old Meta Page ID to `providerPageId`, then store the corresponding
   internal `id` as the new `pageId`. Do not send `providerPageId` to v1.
3. Rename `reply` to `text` and add `"type": "text"`.
4. Generate a stable `Idempotency-Key` for every logical send. Retain it while
   resolving client-side network uncertainty. After a `422`/`502` containing
   `details.messageId`, use a new key only when intentionally starting a new
   provider attempt. Without `details.messageId`, the error occurred before
   the key was reserved/completed, so do not treat it as a stored replay.
5. Update response parsing for the v1 `data` envelope and canonical error
   codes.
6. Test new sends, same-key/same-body replay, and same-key/different-body
   conflict before moving production traffic.
7. Stop calling the legacy endpoint and monitor both endpoint metrics during
   the approved compatibility window.

Do not implement an automatic fallback from v1 to legacy: a fallback can turn
an uncertain response into a duplicate Meta send.

## Legacy deprecation and retirement gate

`POST https://resender.dev/api/meta/send` is **deprecated** and exists only for
temporary migration compatibility. New integrations must use v1.

No retirement date has been approved. Therefore, no calendar date or `Sunset`
header may be invented. Before announcing the compatibility window, the
release owner must record these approved values in the cutover ticket and this
section:

```text
LEGACY_SEND_DEPRECATION_ANNOUNCED_AT=<approved ISO-8601 timestamp>
LEGACY_SEND_SUNSET_AT=<approved ISO-8601 timestamp>
APPROVAL_TICKET=<link or identifier>
```

The compatibility window is the explicit interval from
`LEGACY_SEND_DEPRECATION_ANNOUNCED_AT` through `LEGACY_SEND_SUNSET_AT`.
Removal is blocked until all of the following are true:

1. Arturo approves both timestamps and the customer communication.
2. Public quickstarts and the external docs site use only v1.
3. Affected tenants have been identified and notified.
4. Legacy traffic is zero for the approved observation period.
5. The v1 smoke, idempotency replay, and rollback checks are green.
6. The removal change deletes the legacy handler and its backend dependencies
   without changing the v1 contract.

If any condition is missing at the proposed sunset, extend the approved window
and update customer communication; do not silently remove the endpoint.
