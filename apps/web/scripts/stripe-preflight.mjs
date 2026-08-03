import { readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import Stripe from "stripe"

import { loadEnvFile } from "./load-env.mjs"

// Verificación de solo lectura del modo de Stripe al que apunta la key que se
// le pase. Contrasta lo que existe en Stripe contra lo que el código asume:
// lookup keys de `lib/billing/plans.ts`, el endpoint de webhook que recibe los
// eventos, y la configuración del Customer Portal. No escribe nada.
//
// Uso:
//   npm run stripe:preflight            → lee .env      (modo test)
//   npm run stripe:preflight -- --live  → lee .env.live (modo live)
//
// Una variable ya presente en el entorno gana sobre el archivo, así que
// `STRIPE_SECRET_KEY=rk_live_... npm run stripe:preflight` sigue funcionando.
//
// Los dos archivos están separados a propósito: `.env` es el de desarrollo y
// tiene keys de test, y mezclar ambos modos en un archivo es la forma más fácil
// de correr contra live creyendo que se corre contra test. Ambos los ignora
// git por el patrón `.env*`.
//
// El código lee `subscription.items.data[0].current_period_start|end`, campos
// que solo existen desde la API `2025-03-31.basil`. Un endpoint pinneado a una
// versión anterior entrega eventos que se procesan sin error pero dejan el
// período en NULL: la ventana de cuota deja de contar. Por eso la versión del
// endpoint es una verificación de primer nivel y no un detalle cosmético.
const MIN_WEBHOOK_API_VERSION = "2025-03-31"

const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]

// En `main` el webhook lo atiende el Worker `web`. Tras el cutover de la fase 2
// pasa a ser https://api.resender.dev/webhooks/stripe; se sobreescribe con
// STRIPE_WEBHOOK_URL para verificar ese destino sin tocar el script.
const DEFAULT_WEBHOOK_URL = "https://resender.dev/api/stripe/webhook"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const wantsLive = process.argv.includes("--live")
const envFileName = wantsLive ? ".env.live" : ".env"
const keyCameFromEnvironment = Boolean(process.env.STRIPE_SECRET_KEY)
const envFileFound = await loadEnvFile(path.join(appDir, envFileName))

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey) {
  console.error(
    envFileFound
      ? `${envFileName} no define STRIPE_SECRET_KEY`
      : `Falta ${envFileName}. Créalo con la restricted key:\n` +
          `  STRIPE_SECRET_KEY=rk_${wantsLive ? "live" : "test"}_...`
  )
  process.exit(1)
}

const mode = secretKey.includes("_live_") ? "live" : "test"

// Un desajuste entre la bandera y el archivo significa que el archivo no tiene
// lo que su nombre promete: verificar el modo equivocado y darlo por bueno es
// peor que no verificar. Si la key vino del entorno no hay nada que contrastar,
// se respeta y basta con anunciar el modo detectado.
if (!keyCameFromEnvironment && (mode === "live") !== wantsLive) {
  console.error(
    `${envFileName} tiene una key de ${mode}. ` +
      (wantsLive
        ? "Para live usa la restricted key rk_live_ del Dashboard."
        : "Para verificar live: npm run stripe:preflight -- --live")
  )
  process.exit(1)
}

const webhookUrl = process.env.STRIPE_WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL
const stripe = new Stripe(secretKey, { maxNetworkRetries: 2 })

// El Stripe CLI guarda la key de live en el keychain y solo expone una versión
// enmascarada, así que copiarla desde `stripe config --list` produce un 401.
// Sin este atajo el error sale como stack trace de 60 líneas.
process.on("uncaughtException", (error) => {
  if (error?.type === "StripeAuthenticationError") {
    console.error(
      "\nLa key no es válida. Para live usa la restricted key real " +
        "(rk_live_...) del Dashboard, no la que imprime `stripe config --list`."
    )
    process.exit(1)
  }
  throw error
})

const failures = []
const warnings = []

function check(ok, message, detail) {
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${message}${detail ? ` — ${detail}` : ""}`
  )
  if (!ok) failures.push(message)
}

function warn(message) {
  console.log(`warn  ${message}`)
  warnings.push(message)
}

// La key de la app es restringida y a propósito no puede leer webhooks ni la
// cuenta: pedir esos permisos solo para este script ampliaría el daño de una
// filtración. Cuando falta el permiso se salta la sección en vez de reventar,
// y se reporta como advertencia para que quede claro qué NO se verificó.
async function attempt(section, run) {
  try {
    await run()
  } catch (error) {
    if (error?.type !== "StripePermissionError") throw error
    warn(
      `${section}: sin verificar, la key no tiene permiso de lectura ` +
        `(repite con la key del Stripe CLI o una key con ese scope)`
    )
  }
}

// Las expectativas de precio salen de `lib/billing/plans.ts` para que un cambio
// de plan no pase silenciosamente: si alguien edita el precio ahí, este script
// exige que Stripe lo refleje.
async function expectedPlans() {
  const source = await readFile(
    path.join(appDir, "lib", "billing", "plans.ts"),
    "utf8"
  )
  const plans = [
    ...source.matchAll(
      /lookupKey:\s*"([a-z_]+)",\s*name:\s*"([^"]+)",\s*priceMonthlyUsd:\s*(\d+)/g
    ),
  ].map(([, lookupKey, name, priceMonthlyUsd]) => ({
    lookupKey,
    name,
    unitAmount: Number(priceMonthlyUsd) * 100,
  }))

  if (plans.length === 0) {
    throw new Error("could not parse any plan out of lib/billing/plans.ts")
  }
  return plans
}

console.log(`Stripe preflight — modo ${mode}\n`)

console.log("Planes")
for (const plan of await expectedPlans()) {
  const { data } = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    limit: 1,
    expand: ["data.product"],
  })
  const price = data[0]

  if (!price) {
    check(
      false,
      `${plan.lookupKey}`,
      "no existe ningún price con ese lookup key"
    )
    continue
  }

  const problems = []
  if (!price.active) problems.push("price archivado")
  if (price.currency !== "usd") problems.push(`moneda ${price.currency}`)
  if (price.unit_amount !== plan.unitAmount) {
    problems.push(
      `importe ${price.unit_amount} ≠ ${plan.unitAmount} de plans.ts`
    )
  }
  if (price.recurring?.interval !== "month") problems.push("no es mensual")
  if (typeof price.product === "object" && !price.product.deleted) {
    if (!price.product.active) problems.push("product archivado")
  }

  check(
    problems.length === 0,
    `${plan.lookupKey} (${plan.name})`,
    problems.length === 0 ? price.id : problems.join(", ")
  )
}

console.log("\nWebhook")
await attempt("webhook", async () => {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
  const endpoint = endpoints.data.find((item) => item.url === webhookUrl)

  if (!endpoint) {
    check(false, `endpoint ${webhookUrl}`, "no existe")
    for (const other of endpoints.data) {
      warn(`hay otro endpoint configurado: ${other.url} (${other.status})`)
    }
    return
  }

  check(endpoint.status === "enabled", `endpoint ${webhookUrl}`, endpoint.id)

  const missing = REQUIRED_EVENTS.filter(
    (event) =>
      !endpoint.enabled_events.includes(event) &&
      !endpoint.enabled_events.includes("*")
  )
  check(
    missing.length === 0,
    "eventos suscritos",
    missing.length === 0
      ? `${REQUIRED_EVENTS.length} eventos`
      : `faltan ${missing.join(", ")}`
  )

  const apiVersion = endpoint.api_version ?? "(default de la cuenta)"
  check(
    Boolean(endpoint.api_version) &&
      endpoint.api_version >= MIN_WEBHOOK_API_VERSION,
    "API version del endpoint",
    `${apiVersion} (se requiere >= ${MIN_WEBHOOK_API_VERSION}; con una anterior current_period_* llega vacío)`
  )

  const extra = endpoint.enabled_events.filter(
    (event) => event !== "*" && !REQUIRED_EVENTS.includes(event)
  )
  if (extra.length > 0) {
    warn(`el endpoint recibe eventos que el código ignora: ${extra.join(", ")}`)
  }
})

console.log("\nCustomer Portal")
await attempt("customer portal", async () => {
  const configurations = await stripe.billingPortal.configurations.list({
    limit: 100,
  })
  const defaultConfiguration = configurations.data.find(
    (item) => item.is_default && item.active
  )

  // El código crea sesiones de Portal sin pasar `configuration`, así que Stripe
  // usa la default. Sin una default activa, cancelar o cambiar de plan revienta.
  check(
    Boolean(defaultConfiguration),
    "configuración default activa",
    defaultConfiguration?.id ??
      "ninguna (billingPortal.sessions.create fallará)"
  )
  if (!defaultConfiguration) return

  const features = defaultConfiguration.features
  check(
    features.subscription_cancel?.enabled === true &&
      features.subscription_cancel.mode === "at_period_end",
    "cancelación al fin del período",
    features.subscription_cancel?.enabled
      ? `mode ${features.subscription_cancel.mode} (ADR 0002 pide at_period_end)`
      : "deshabilitada"
  )
  check(
    features.subscription_update?.enabled === true,
    "cambio de plan habilitado"
  )
  check(
    features.payment_method_update?.enabled === true,
    "actualización de método de pago habilitada"
  )
  if (features.invoice_history?.enabled !== true) {
    warn("el historial de facturas está deshabilitado en el Portal")
  }
})

console.log("\nCuenta")
await attempt("cuenta", async () => {
  const account = await stripe.accounts.retrieve()
  check(account.charges_enabled === true, "charges_enabled")
  check(account.details_submitted === true, "details_submitted")
  if (account.payouts_enabled !== true) {
    warn("payouts_enabled es false: se puede cobrar pero no recibir el dinero")
  }
})

console.log(
  `\n${failures.length === 0 ? "Listo para cobrar" : `${failures.length} bloqueante(s)`}` +
    `${warnings.length > 0 ? `, ${warnings.length} advertencia(s)` : ""}`
)
process.exit(failures.length === 0 ? 0 : 1)
