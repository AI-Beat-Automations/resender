import Stripe from "stripe"

let client: Stripe | undefined

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is required")
  // Los retries del SDK llevan idempotency keys automáticas: un timeout de
  // red no puede crear objetos duplicados en Stripe.
  // El httpClient explícito de fetch es necesario en Cloudflare Workers: con
  // nodejs_compat el SDK detecta Node y usa node:https, que ahí falla con
  // StripeConnectionError; fetch funciona igual en local (Node 18+) y en CF.
  client ??= new Stripe(secretKey, {
    maxNetworkRetries: 2,
    httpClient: Stripe.createFetchHttpClient(),
  })
  return client
}
