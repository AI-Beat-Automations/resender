import { describe, expect, it } from "vitest"

import {
  ContractError,
  ERROR_CODES,
  type ErrorCode,
} from "@workspace/contracts"

import { classifyRpcError } from "./rpc-error"

const EXPECTED = {
  invalid_json: { kind: "protocol", retryable: false, status: 400 },
  validation_error: { kind: "validation", retryable: false, status: 400 },
  missing_api_key: { kind: "protocol", retryable: false, status: 401 },
  invalid_api_key: { kind: "protocol", retryable: false, status: 401 },
  account_waitlisted: {
    kind: "access",
    retryable: false,
    status: 403,
    destination: "/waitlist",
  },
  subscription_required: {
    kind: "access",
    retryable: false,
    status: 403,
    destination: "/billing",
  },
  page_limit_exceeded: {
    kind: "entitlement",
    retryable: false,
    status: 403,
  },
  plan_unavailable: {
    kind: "entitlement",
    retryable: false,
    status: 403,
  },
  quota_exceeded: {
    kind: "entitlement",
    retryable: false,
    status: 402,
  },
  not_found: { kind: "not_found", retryable: false, status: 404 },
  idempotency_conflict: {
    kind: "protocol",
    retryable: false,
    status: 409,
  },
  provider_rejected: {
    kind: "provider",
    retryable: false,
    status: 422,
  },
  provider_unavailable: {
    kind: "transient",
    retryable: true,
    status: 502,
  },
  rate_limited: {
    kind: "transient",
    retryable: true,
    status: 429,
  },
  invalid_signature: {
    kind: "protocol",
    retryable: false,
    status: 400,
  },
  internal_error: {
    kind: "internal",
    retryable: false,
    status: 500,
  },
} as const satisfies Record<
  ErrorCode,
  {
    kind: string
    retryable: boolean
    status: number
    destination?: "/waitlist" | "/billing"
  }
>

describe("classifyRpcError", () => {
  it("classifies a real ContractError without relying on its prototype", () => {
    const error = new ContractError({
      code: "account_waitlisted",
      message: "raw access message",
      status: 403,
    })

    expect(classifyRpcError(error)).toEqual({
      kind: "access",
      code: "account_waitlisted",
      status: 403,
      retryable: false,
      destination: "/waitlist",
    })
  })

  it("classifies a serializable clone with the same result", () => {
    const original = new ContractError({
      code: "subscription_required",
      message: "raw billing message",
      status: 403,
    })
    const clone = JSON.parse(
      JSON.stringify({
        code: original.code,
        status: original.status,
        message: original.message,
        details: original.details,
      })
    ) as unknown

    expect(classifyRpcError(clone)).toEqual({
      kind: "access",
      code: "subscription_required",
      status: 403,
      retryable: false,
      destination: "/billing",
    })
  })

  it.each(ERROR_CODES)("classifies %s exhaustively", (code) => {
    const expected = EXPECTED[code]

    expect(
      classifyRpcError({
        code,
        status: expected.status,
        message: `raw ${code} message`,
      })
    ).toEqual({
      kind: expected.kind,
      code,
      status: expected.status,
      retryable: expected.retryable,
      ...("destination" in expected
        ? { destination: expected.destination }
        : {}),
    })
  })

  it.each([
    null,
    [],
    {},
    { code: "not_found", status: 404 },
    { code: "invented", status: 404, message: "fake" },
    { code: "not_found", status: 200, message: "fake" },
    { code: "not_found", status: 403, message: "fake" },
    { code: "not_found", status: 404, message: { body: "secret" } },
    {
      code: "validation_error",
      status: 400,
      message: "fake",
      details: "not-an-array",
    },
    {
      code: "validation_error",
      status: 400,
      message: "fake",
      details: [{ path: "email" }],
    },
  ])("fails closed for partial or false shape %#", (value) => {
    expect(classifyRpcError(value)).toEqual({
      kind: "unexpected",
      code: null,
      status: null,
      retryable: false,
    })
  })

  it("allowlists validation fields without retaining raw messages or bodies", () => {
    const raw = {
      code: "validation_error",
      status: 400,
      message: "request body contained super-secret",
      details: [
        {
          path: "returnUrl",
          message: "provider said super-secret",
          messageId: "provider-message-secret",
        },
        {
          path: "providerPageIds.0",
          message: "page-token-secret",
        },
        {
          path: "body.accessToken",
          message: "access-token-secret",
        },
        {
          path: "origin",
          message: "duplicate raw message",
        },
      ],
      body: { password: "body-secret" },
    }

    const result = classifyRpcError(raw)

    expect(result).toEqual({
      kind: "validation",
      code: "validation_error",
      status: 400,
      retryable: false,
      details: [
        { field: "returnUrl", issue: "invalid" },
        { field: "providerPageIds", issue: "invalid" },
        { field: "origin", issue: "invalid" },
      ],
    })
    expect(JSON.stringify(result)).not.toMatch(
      /super-secret|provider-message|page-token|access-token|body-secret/u
    )
    expect(result).not.toHaveProperty("message")
  })

  it("never exposes provider message or details", () => {
    const result = classifyRpcError({
      code: "provider_rejected",
      status: 422,
      message: "provider-token-secret",
      details: [
        {
          path: "body",
          message: "provider-body-secret",
          messageId: "provider-id-secret",
        },
      ],
    })

    expect(result).toEqual({
      kind: "provider",
      code: "provider_rejected",
      status: 422,
      retryable: false,
    })
    expect(JSON.stringify(result)).not.toMatch(/provider-|secret|body/u)
  })
})
