import Stripe from "stripe"

let client: Stripe | undefined

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is required")
  // Los retries del SDK llevan idempotency keys automáticas: un timeout de
  // red no puede crear objetos duplicados en Stripe.
  client ??= new Stripe(secretKey, { maxNetworkRetries: 2 })
  return client
}
