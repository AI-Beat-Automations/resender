"use client"

import Link from "next/link"

import { openPortal } from "@/features/billing/actions"
import { Button } from "@workspace/ui/components/button"

export type SubscriptionView = {
  planName: string
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  // Consumo del período vigente contra el límite del plan; `limit` es null
  // cuando el plan no se pudo resolver.
  usage: number
  messageLimit: number | null
  pagesInUse: number
  pageLimit: number | null
}

export function SubscriptionPanel({
  subscription,
}: {
  subscription: SubscriptionView | null
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="font-medium">Subscription</h2>
      {subscription ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Plan: <span className="text-foreground">{subscription.planName}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Status: <span className="text-foreground">{subscription.status}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Messages this period:{" "}
            <span className="text-foreground">
              {formatCount(subscription.usage)} /{" "}
              {formatCount(subscription.messageLimit)}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Connected Pages:{" "}
            <span className="text-foreground">
              {formatCount(subscription.pagesInUse)} /{" "}
              {formatCount(subscription.pageLimit)}
            </span>
          </p>
          {subscription.currentPeriodEnd && (
            <p className="mt-1 text-sm text-muted-foreground">
              {subscription.cancelAtPeriodEnd
                ? "Cancels on"
                : "Renews on"}{" "}
              <span className="text-foreground">
                {formatDate(subscription.currentPeriodEnd)}
              </span>
            </p>
          )}
          <form action={openPortal} className="mt-4">
            <Button type="submit" variant="outline">
              Manage subscription
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Change plan, update your payment method or cancel in the Stripe
            Customer Portal.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          No subscription on file.{" "}
          <Link
            href="/billing"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Choose a plan
          </Link>
          .
        </p>
      )}
    </section>
  )
}

function formatCount(value: number | null): string {
  if (value === null) return "—"
  return value.toLocaleString("en-US")
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}
