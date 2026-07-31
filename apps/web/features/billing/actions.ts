"use server"

import "server-only"

import { redirect } from "next/navigation"
import {
  BillingPortalSessionRpcInputSchema,
  CheckoutSessionRpcInputSchema,
  type RpcActor,
} from "@workspace/contracts"

import { auth } from "@/auth"
import {
  BackendRpcError,
  createBillingPortalSession,
  createCheckoutSession,
} from "@/lib/backend/backend"
import { isPlanLookupKey } from "@/lib/billing/plans"

type BillingActionOutcome =
  | { kind: "redirect"; destination: "/waitlist" | "/billing" }
  | { kind: "stripe"; url: string }

// Checkout and Customer Portal stay hosted by Stripe. Next authenticates the
// action, sends only the plan plus the configured web origin, then redirects to
// the API-validated Stripe URL. Stripe state and secrets never enter this app.
export async function startCheckout(lookupKey: string): Promise<void> {
  const actor = await authenticatedActor()
  if (!actor) redirect("/login")
  if (!isPlanLookupKey(lookupKey)) redirect("/billing")

  const input = CheckoutSessionRpcInputSchema.safeParse({
    priceLookupKey: lookupKey,
    origin: configuredAppOrigin(),
  })
  if (!input.success) throw new Error("APP_URL must be an exact web origin.")

  const outcome = await performBillingMutation(
    () => createCheckoutSession(actor, input.data),
    "checkout"
  )
  if (outcome.kind === "redirect") redirect(outcome.destination)
  redirect(outcome.url)
}

export async function openPortal(): Promise<void> {
  const actor = await authenticatedActor()
  if (!actor) redirect("/login")

  const input = BillingPortalSessionRpcInputSchema.safeParse({
    origin: configuredAppOrigin(),
  })
  if (!input.success) throw new Error("APP_URL must be an exact web origin.")

  const outcome = await performBillingMutation(
    () => createBillingPortalSession(actor, input.data),
    "portal"
  )
  if (outcome.kind === "redirect") redirect(outcome.destination)
  redirect(outcome.url)
}

async function authenticatedActor(): Promise<RpcActor | null> {
  const session = await auth()
  return session?.user?.id ? { userId: session.user.id } : null
}

function configuredAppOrigin(): string {
  const value = process.env.APP_URL
  if (!value) throw new Error("APP_URL is required.")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("APP_URL must be an exact web origin.")
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value.replace(/\/$/u, "")
  ) {
    throw new Error("APP_URL must be an exact web origin.")
  }
  return url.origin
}

async function performBillingMutation(
  operation: () => Promise<{ url: string }>,
  surface: "checkout" | "portal"
): Promise<BillingActionOutcome> {
  try {
    return { kind: "stripe", url: (await operation()).url }
  } catch (error) {
    if (!(error instanceof BackendRpcError)) throw error
    const { classification } = error
    if (
      classification.code === "account_waitlisted" ||
      (classification.kind === "not_found" && surface === "checkout")
    ) {
      return { kind: "redirect", destination: "/waitlist" }
    }
    if (
      classification.code === "subscription_required" ||
      classification.code === "plan_unavailable" ||
      classification.kind === "validation" ||
      classification.kind === "not_found"
    ) {
      return { kind: "redirect", destination: "/billing" }
    }
    throw error
  }
}
