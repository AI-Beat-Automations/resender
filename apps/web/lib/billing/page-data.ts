import "server-only"

import {
  CheckoutVerificationRpcInputSchema,
  type BillingStateDto,
  type CheckoutVerificationDto,
  type CheckoutVerificationRpcInput,
  type RpcActor,
} from "@workspace/contracts"

import {
  BackendRpcError,
  getBillingState,
  verifyCheckoutSession,
} from "@/lib/backend/backend"

export type BillingSuccessResult =
  | { kind: "ready" }
  | {
      kind: "redirect"
      destination: "/waitlist" | "/billing" | "/connections"
    }

type BillingSuccessDependencies = {
  getBillingState(actor: RpcActor): Promise<BillingStateDto>
  verifyCheckoutSession(
    actor: RpcActor,
    input: CheckoutVerificationRpcInput
  ): Promise<CheckoutVerificationDto>
}

const DEFAULT_DEPENDENCIES: BillingSuccessDependencies = {
  getBillingState,
  verifyCheckoutSession,
}

// A completed Checkout is only a safe UX signal. Product access remains
// derived from the subscription row written by the signed Stripe webhook.
export async function loadBillingSuccess(
  actor: RpcActor,
  sessionId: string | undefined,
  dependencies: BillingSuccessDependencies = DEFAULT_DEPENDENCIES
): Promise<BillingSuccessResult> {
  let billing: BillingStateDto
  try {
    billing = await dependencies.getBillingState(actor)
  } catch (error) {
    const destination = billingAccessDestination(error)
    if (destination) return { kind: "redirect", destination }
    throw error
  }

  if (billing.subscription?.status === "active") {
    return { kind: "redirect", destination: "/connections" }
  }

  const input = CheckoutVerificationRpcInputSchema.safeParse({ sessionId })
  if (!input.success) {
    return { kind: "redirect", destination: "/billing" }
  }

  try {
    const verification = await dependencies.verifyCheckoutSession(
      actor,
      input.data
    )
    return verification.complete
      ? { kind: "ready" }
      : { kind: "redirect", destination: "/billing" }
  } catch (error) {
    if (error instanceof BackendRpcError) {
      if (error.classification.code === "account_waitlisted") {
        return { kind: "redirect", destination: "/waitlist" }
      }
      if (
        error.classification.code === "subscription_required" ||
        error.classification.kind === "not_found" ||
        error.classification.kind === "validation"
      ) {
        return { kind: "redirect", destination: "/billing" }
      }
    }
    throw error
  }
}

function billingAccessDestination(
  error: unknown
): "/waitlist" | "/billing" | null {
  if (!(error instanceof BackendRpcError)) return null
  if (
    error.classification.code === "account_waitlisted" ||
    error.classification.code === "not_found"
  ) {
    return "/waitlist"
  }
  if (error.classification.code === "subscription_required") return "/billing"
  return null
}
