import Stripe from "stripe"

let client: Stripe | undefined

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is required")
  client ??= new Stripe(secretKey)
  return client
}
