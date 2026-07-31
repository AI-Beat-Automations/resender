import "server-only"

import { ERROR_CODES, type ErrorCode } from "@workspace/contracts"

export type RpcErrorKind =
  | "access"
  | "validation"
  | "entitlement"
  | "not_found"
  | "provider"
  | "transient"
  | "internal"
  | "protocol"
  | "unexpected"

export type RpcAccessDestination = "/waitlist" | "/billing"

const VALIDATION_FIELDS = [
  "input",
  "userId",
  "email",
  "password",
  "newPassword",
  "confirmEmail",
  "label",
  "apiKeyId",
  "priceLookupKey",
  "origin",
  "returnUrl",
  "sessionId",
  "code",
  "redirectUri",
  "providerPageIds",
  "pageId",
  "webhookUrl",
  "conversationId",
  "cursor",
  "limit",
  "updatedAfter",
  "status",
  "Idempotency-Key",
  "recipientId",
  "type",
  "text",
] as const

export type ValidationField = (typeof VALIDATION_FIELDS)[number]

export type SanitizedValidationDetail = {
  field: ValidationField
  issue: "invalid"
}

export type RpcErrorClassification = {
  kind: RpcErrorKind
  code: ErrorCode | null
  status: number | null
  retryable: boolean
  destination?: RpcAccessDestination
  details?: SanitizedValidationDetail[]
}

type ClassificationRule = {
  kind: Exclude<RpcErrorKind, "unexpected">
  retryable: boolean
  statuses: readonly number[]
  destination?: RpcAccessDestination
}

const RULES = {
  invalid_json: {
    kind: "protocol",
    retryable: false,
    statuses: [400],
  },
  validation_error: {
    kind: "validation",
    retryable: false,
    statuses: [400, 409],
  },
  missing_api_key: {
    kind: "protocol",
    retryable: false,
    statuses: [401],
  },
  invalid_api_key: {
    kind: "protocol",
    retryable: false,
    statuses: [401],
  },
  account_waitlisted: {
    kind: "access",
    retryable: false,
    statuses: [403],
    destination: "/waitlist",
  },
  subscription_required: {
    kind: "access",
    retryable: false,
    statuses: [403],
    destination: "/billing",
  },
  page_limit_exceeded: {
    kind: "entitlement",
    retryable: false,
    statuses: [403],
  },
  plan_unavailable: {
    kind: "entitlement",
    retryable: false,
    statuses: [403],
  },
  quota_exceeded: {
    kind: "entitlement",
    retryable: false,
    statuses: [402],
  },
  not_found: {
    kind: "not_found",
    retryable: false,
    statuses: [404],
  },
  idempotency_conflict: {
    kind: "protocol",
    retryable: false,
    statuses: [409],
  },
  provider_rejected: {
    kind: "provider",
    retryable: false,
    statuses: [422],
  },
  provider_unavailable: {
    kind: "transient",
    retryable: true,
    statuses: [502],
  },
  rate_limited: {
    kind: "transient",
    retryable: true,
    statuses: [429],
  },
  invalid_signature: {
    kind: "protocol",
    retryable: false,
    statuses: [400],
  },
  internal_error: {
    kind: "internal",
    retryable: false,
    statuses: [500],
  },
} as const satisfies Record<ErrorCode, ClassificationRule>

const ERROR_CODE_SET = new Set<string>(ERROR_CODES)
const VALIDATION_FIELD_SET = new Set<string>(VALIDATION_FIELDS)

type ParsedRpcError = {
  code: ErrorCode
  status: number
  detailPaths: Array<string | undefined>
}

export function classifyRpcError(error: unknown): RpcErrorClassification {
  const parsed = parseRpcError(error)
  if (!parsed) return unexpected()

  const rule = RULES[parsed.code]
  if (!(rule.statuses as readonly number[]).includes(parsed.status)) {
    return unexpected()
  }

  const classification: RpcErrorClassification = {
    kind: rule.kind,
    code: parsed.code,
    status: parsed.status,
    retryable: rule.retryable,
  }

  if ("destination" in rule) {
    classification.destination = rule.destination
  }
  if (parsed.code === "validation_error") {
    const details = sanitizeValidationDetails(parsed.detailPaths)
    if (details.length > 0) classification.details = details
  }

  return classification
}

function parseRpcError(value: unknown): ParsedRpcError | null {
  if (!isRecord(value)) return null
  if (!isErrorCode(value.code)) return null
  if (
    !Number.isInteger(value.status) ||
    (value.status as number) < 400 ||
    (value.status as number) > 599
  ) {
    return null
  }
  if (
    typeof value.message !== "string" ||
    value.message.length === 0 ||
    value.message.length > 2_000
  ) {
    return null
  }

  const detailPaths = parseDetailPaths(value.details)
  if (!detailPaths) return null

  return {
    code: value.code,
    status: value.status as number,
    detailPaths,
  }
}

function parseDetailPaths(value: unknown): Array<string | undefined> | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) return null

  const paths: Array<string | undefined> = []
  for (const detail of value) {
    if (!isRecord(detail)) return null
    if (
      typeof detail.message !== "string" ||
      detail.message.length === 0 ||
      detail.message.length > 2_000
    ) {
      return null
    }
    if (
      detail.path !== undefined &&
      (typeof detail.path !== "string" ||
        detail.path.length === 0 ||
        detail.path.length > 200)
    ) {
      return null
    }
    if (
      detail.messageId !== undefined &&
      (typeof detail.messageId !== "string" ||
        detail.messageId.length === 0 ||
        detail.messageId.length > 255)
    ) {
      return null
    }
    paths.push(detail.path as string | undefined)
  }
  return paths
}

function sanitizeValidationDetails(
  paths: Array<string | undefined>
): SanitizedValidationDetail[] {
  const seen = new Set<ValidationField>()
  const details: SanitizedValidationDetail[] = []

  for (const path of paths) {
    const field = path?.split(".", 1)[0]
    if (!field || !VALIDATION_FIELD_SET.has(field)) continue
    const validationField = field as ValidationField
    if (seen.has(validationField)) continue
    seen.add(validationField)
    details.push({ field: validationField, issue: "invalid" })
  }

  return details
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unexpected(): RpcErrorClassification {
  return {
    kind: "unexpected",
    code: null,
    status: null,
    retryable: false,
  }
}
