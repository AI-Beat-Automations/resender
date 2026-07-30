import "server-only"

import type {
  ProductAccessDto,
  ProductShellDto,
} from "@workspace/contracts"

import {
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"
import type {
  RpcErrorClassification,
  RpcErrorKind,
} from "@/lib/backend/rpc-error"

export type ProductRedirect =
  | "/waitlist"
  | "/billing"
  | "/connections"
  | null

export type ProductShellFailureDecision =
  | { kind: "redirect"; destination: "/waitlist" | "/billing" }
  | {
      kind: "omit_notice"
      log: {
        kind: RpcErrorKind | "unavailable"
        code: RpcErrorClassification["code"]
        status: number | null
        retryable: boolean
      }
    }
  | { kind: "throw" }

export function productPageRedirect(
  access: ProductAccessDto
): ProductRedirect {
  if (access.destination === "waitlist") return "/waitlist"
  if (access.destination === "billing") return "/billing"
  return null
}

export function billingPageRedirect(
  access: ProductAccessDto
): ProductRedirect {
  if (access.destination === "waitlist") return "/waitlist"
  if (access.destination === "product") return "/connections"
  return null
}

export function waitlistPageRedirect(
  access: ProductAccessDto
): ProductRedirect {
  return access.destination === "waitlist" ? null : "/connections"
}

export function productShellFailureDecision(
  error: unknown
): ProductShellFailureDecision {
  if (error instanceof BackendUnavailableError) {
    return {
      kind: "omit_notice",
      log: {
        kind: "unavailable",
        code: null,
        status: null,
        retryable: true,
      },
    }
  }
  if (!(error instanceof BackendRpcError)) return { kind: "throw" }

  const { classification } = error
  if (
    classification.code === "account_waitlisted" ||
    classification.code === "not_found"
  ) {
    return { kind: "redirect", destination: "/waitlist" }
  }
  if (classification.code === "subscription_required") {
    return { kind: "redirect", destination: "/billing" }
  }
  if (
    classification.kind === "internal" ||
    classification.kind === "transient" ||
    classification.kind === "provider"
  ) {
    return {
      kind: "omit_notice",
      log: {
        kind: classification.kind,
        code: classification.code,
        status: classification.status,
        retryable: classification.retryable,
      },
    }
  }
  return { kind: "throw" }
}

export function productShellNotice(shell: ProductShellDto): {
  level: "warning" | "restricted"
  usage: number
  limit: number | null
  blockCode: ProductShellDto["entitlement"]["blockCode"]
  activePageCount: number
  maxPages: number | null
} | null {
  const { entitlement } = shell
  const noticeLevel =
    entitlement.noticeLevel ?? (entitlement.blockCode ? "blocked" : null)
  if (!noticeLevel) return null

  return {
    level: noticeLevel === "blocked" ? "restricted" : "warning",
    usage: entitlement.usage,
    limit: entitlement.messageLimit,
    blockCode: entitlement.blockCode,
    activePageCount: entitlement.activePageCount,
    maxPages: entitlement.pageLimit,
  }
}
