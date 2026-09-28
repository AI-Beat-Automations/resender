#!/usr/bin/env node
// ===========================================================================
// whatsapp-template-backfill — sincroniza el catálogo de plantillas de los
// números de WhatsApp que ya estaban conectados (issue #192)
// ===========================================================================
//
// Desde la 0032, conectar un número encola `template_sync` en los dos flujos.
// Los números conectados **antes** de ese despliegue no pasaron por ahí, y
// `GET /api/meta/whatsapp/templates` les lista vacío. Este script encola un
// `template_sync` por WABA con al menos un número activo. Se corre una vez por
// entorno, después de desplegar y de migrar.
//
// El job lo hace el consumidor de siempre (`lib/jobs/whatsapp-queue.ts`); acá
// solo se encola. Por qué por la API REST de Cloudflare y no de otra forma: la
// cola solo tiene binding dentro del Worker, y un script de Node no lo tiene.
// Hacer el sync acá mismo sería un segundo cliente de Graph —con su propio
// descifrado del token— al lado del que ya existe.
//
// Es idempotente: el sync es un upsert por `(waba_id, name, language)` que no
// toca el dueño. Correrlo dos veces cuesta dos listados a Graph y nada más.
//
// ---------------------------------------------------------------------------
// Uso
// ---------------------------------------------------------------------------
//
//   # (también `npm run whatsapp:template-backfill -- [--send] [--queue …]`)
//
//   # 1. Ver qué se encolaría (no encola nada)
//   node scripts/whatsapp-template-backfill.mjs
//
//   # 2. Encolar de verdad en producción
//   node scripts/whatsapp-template-backfill.mjs --send
//
//   # Staging tiene su propia cola
//   node scripts/whatsapp-template-backfill.mjs --send --queue whatsapp-jobs-staging
//
// Variables (se leen del entorno o de `.env`):
//
//   DATABASE_URL            la base del entorno que se va a sincronizar
//   CLOUDFLARE_ACCOUNT_ID   solo con --send
//   CLOUDFLARE_API_TOKEN    solo con --send; permiso «Queues: Edit»
//
// **La base y la cola tienen que ser del mismo entorno**: los ids de conexión
// de producción encolados en staging se descartan como `connection_not_active`
// —no hacen daño, pero no sincronizan nada—.
//
// Qué mirar después: en Workers Logs, `action = template_sync`. Una línea `ok`
// por WABA con el `count` de plantillas; `dropped` con `connection_not_active`
// si la conexión se desconectó en el medio; `failed` con
// `template_list_failed` si Graph rechazó el listado (token vencido, casi
// siempre), que la cola reintenta sola.

import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import postgres from "postgres"

import { loadEnvFile } from "./load-env.mjs"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

await loadEnvFile(path.join(appDir, ".env"))

const args = process.argv.slice(2)
const send = args.includes("--send")
const queueFlag = args.indexOf("--queue")
const queueName = queueFlag === -1 ? "whatsapp-jobs" : args[queueFlag + 1]

if (!queueName) {
  console.error("--queue needs a queue name")
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL is required")
  process.exit(1)
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
if (send && (!accountId || !apiToken)) {
  console.error("--send needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN")
  process.exit(1)
}

// Un número por WABA alcanza: el catálogo es de la WABA, no del número. Se toma
// el conectado más recientemente, que es el de token más fresco.
const sql = postgres(databaseUrl, { max: 1 })
let connections
try {
  connections = await sql`
    select distinct on (waba_id) id, waba_id, meta_page_id
    from connected_pages
    where channel = 'whatsapp'
      and status = 'active'
      and waba_id is not null
    order by waba_id, connected_at desc
  `
} finally {
  await sql.end()
}

console.error(`${connections.length} WABA(s) con al menos un número activo`)
for (const connection of connections) {
  console.error(
    `  waba ${connection.waba_id} ← conexión ${connection.id} (número ${connection.meta_page_id})`
  )
}

if (!send) {
  console.error("\nNada encolado. Repetir con --send para encolar.")
  process.exit(0)
}

if (connections.length === 0) process.exit(0)

const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues`
const headers = {
  Authorization: `Bearer ${apiToken}`,
  "Content-Type": "application/json",
}

async function cloudflare(url, init) {
  const response = await fetch(url, { ...init, headers })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.success) {
    const detail = data?.errors?.map((error) => error.message).join("; ")
    throw new Error(`Cloudflare API ${response.status}: ${detail ?? "sin detalle"}`)
  }
  return data.result
}

const queues = await cloudflare(`${api}?per_page=100`)
const queue = queues.find((candidate) => candidate.queue_name === queueName)
if (!queue) {
  console.error(`No existe la cola ${queueName} en la cuenta`)
  process.exit(1)
}

// Tandas de 100: el tope del endpoint por request.
for (let start = 0; start < connections.length; start += 100) {
  const chunk = connections.slice(start, start + 100)
  await cloudflare(`${api}/${queue.queue_id}/messages/batch`, {
    method: "POST",
    body: JSON.stringify({
      messages: chunk.map((connection) => ({
        content_type: "json",
        body: { type: "template_sync", connectionId: connection.id },
      })),
    }),
  })
}

console.error(`\n${connections.length} template_sync encolado(s) en ${queueName}`)
