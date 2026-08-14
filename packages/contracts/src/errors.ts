export const ERROR_CODES = [
  "invalid_json",
  "validation_error",
  "missing_api_key",
  "invalid_api_key",
  "account_waitlisted",
  "subscription_required",
  // Un canal apagado para esa cuenta. Nace genérico y no `instagram_not_enabled`
  // porque el mismo bloqueo espera a WhatsApp (ADR 0010); el canal lo nombra el
  // `message`, no el código.
  "channel_not_enabled",
  "page_limit_exceeded",
  "plan_unavailable",
  "quota_exceeded",
  "not_found",
  "idempotency_conflict",
  "provider_rejected",
  "provider_unavailable",
  "rate_limited",
  "invalid_signature",
  "internal_error",
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export type ErrorDetail = {
  path?: string
  message: string
  messageId?: string
}

export type ErrorEnvelope = {
  error: {
    code: ErrorCode
    message: string
    requestId: string
    details?: ErrorDetail[]
  }
}

export type RpcErrorDto = {
  code: ErrorCode
  message: string
  details?: ErrorDetail[]
}

export class ContractError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: ErrorDetail[]

  constructor(input: {
    code: ErrorCode
    message: string
    status: number
    details?: ErrorDetail[]
  }) {
    super(input.message)
    this.name = "ContractError"
    this.code = input.code
    this.status = input.status
    this.details = input.details
  }

  toRpcError(): RpcErrorDto {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}
