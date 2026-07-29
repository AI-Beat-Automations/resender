import Stripe from "stripe"

export type StripeClient = Stripe

export const stripeTransport = {
  create(secretKey: string): Stripe {
    return new Stripe(secretKey, {
      httpClient: Stripe.createFetchHttpClient(),
    })
  },
}

export function createStripeClient(secretKey: string): Stripe {
  return stripeTransport.create(secretKey)
}

export function stripeTimestamp(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null
}
