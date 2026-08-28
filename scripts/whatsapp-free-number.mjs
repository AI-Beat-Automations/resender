#!/usr/bin/env node
// Libera un número de WhatsApp usado en una prueba, para poder reusarlo.
//
// Existe porque el botón «Desconectar» de la app NO toca Meta: marca la fila
// como desconectada y da de baja el webhook, pero el número sigue registrado
// en Cloud API y por tanto sigue inutilizable para otra prueba —y para volver
// a la app de WhatsApp Business—.
//
// Liberar un número son dos llamadas, en este orden y no en otro:
//
//   1. POST /{phone_number_id}/deregister  → lo saca de Cloud API
//   2. DELETE /{phone_number_id}           → lo saca de la WABA
//
// El paso 1 es el que de verdad libera el número; el 2 es la limpieza para que
// la WABA de pruebas no se llene. Al revés no funciona: borrado de la WABA, ya
// no hay id contra el que hacer `deregister`.
//
// ⚠️ **El paso 2 no está soportado por Graph**: verificado contra la API real,
// un `DELETE` sobre un phone_number_id devuelve `code 100 subcode 33`. Borrar
// el número de la WABA es un paso de UI (WhatsApp Manager). Se sigue
// intentando —cuesta una llamada y el día que Meta lo habilite funciona solo—
// pero su fallo no aborta nada y el script lo dice sin dramatizar.
//
// Uso:
//   node scripts/whatsapp-free-number.mjs list
//   node scripts/whatsapp-free-number.mjs list --waba <WABA_ID>
//   node scripts/whatsapp-free-number.mjs free <PHONE_NUMBER_ID> [--pin 123456]
//
// Token: variable de entorno WHATSAPP_ADMIN_TOKEN, o --token <valor>.
// El más cómodo es el temporal de App Dashboard → WhatsApp → Configuración de
// la API (24 h). Para `list` sin --waba hace falta además `business_management`,
// que ese token temporal no trae: usa un token de system user, o pasa --waba.

import { createInterface } from "node:readline/promises"

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v23.0"
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith("--")) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true
      } else {
        flags[key] = next
        i += 1
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

const { positional, flags } = parseArgs(process.argv.slice(2))
const command = positional[0]

const token = flags.token ?? process.env.WHATSAPP_ADMIN_TOKEN

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

async function graph(path, { method = "GET", params = {} } = {}) {
  const url = new URL(`${GRAPH}/${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  })

  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }

  if (!response.ok || body?.error) {
    const error = body?.error ?? {}
    const parts = [
      error.message ?? `HTTP ${response.status}`,
      error.code !== undefined ? `code ${error.code}` : null,
      error.error_subcode ? `subcode ${error.error_subcode}` : null,
      error.error_user_msg ?? null,
    ].filter(Boolean)
    throw new Error(parts.join(" · "))
  }

  return body
}

// ---------------------------------------------------------------------------
// list — de dónde sale el phone_number_id
// ---------------------------------------------------------------------------

async function listNumbers(wabaId) {
  const body = await graph(`${wabaId}/phone_numbers`, {
    params: {
      fields:
        "id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type",
    },
  })
  return body.data ?? []
}

async function discoverWabas() {
  const businesses = await graph("me/businesses", { params: { fields: "id,name" } })
  const wabas = []

  for (const business of businesses.data ?? []) {
    // Las propias y las de clientes: un número de prueba puede estar en
    // cualquiera de las dos según por qué flujo entró.
    for (const edge of [
      "owned_whatsapp_business_accounts",
      "client_whatsapp_business_accounts",
    ]) {
      try {
        const body = await graph(`${business.id}/${edge}`, {
          params: { fields: "id,name" },
        })
        for (const waba of body.data ?? []) {
          wabas.push({ ...waba, businessName: business.name, edge })
        }
      } catch (error) {
        console.warn(
          `  (no se pudo leer ${edge} de ${business.name}: ${error.message})`
        )
      }
    }
  }

  return wabas
}

async function runList() {
  const wabaFlag = typeof flags.waba === "string" ? flags.waba : null

  const wabas = wabaFlag
    ? [{ id: wabaFlag, name: "(--waba)", businessName: "—" }]
    : await discoverWabas()

  if (wabas.length === 0) {
    console.log(
      "Ninguna WABA visible con este token.\n" +
        "Si usaste el token temporal de la app, no trae `business_management`:\n" +
        "pasa --waba <WABA_ID> (lo ves en WhatsApp Manager) o usa un token de system user."
    )
    return
  }

  for (const waba of wabas) {
    console.log(`\nWABA ${waba.id} — ${waba.name} [${waba.businessName}]`)
    let numbers
    try {
      numbers = await listNumbers(waba.id)
    } catch (error) {
      console.log(`  error: ${error.message}`)
      continue
    }
    if (numbers.length === 0) {
      console.log("  (sin números)")
      continue
    }
    for (const number of numbers) {
      // `platform_type` distingue el número que vive en la app de WhatsApp
      // Business del que está solo en Cloud API: es la señal de si estás a
      // punto de tocar un número de Coexistence.
      const marks = [
        number.code_verification_status,
        number.quality_rating,
        number.platform_type,
      ]
        .filter(Boolean)
        .join(", ")
      console.log(
        `  ${number.id}  ${number.display_phone_number}  «${number.verified_name ?? "—"}»${marks ? `  (${marks})` : ""}`
      )
    }
  }

  console.log(
    "\nEl primer valor de cada línea es el phone_number_id:\n" +
      "  node scripts/whatsapp-free-number.mjs free <PHONE_NUMBER_ID>"
  )
}

// ---------------------------------------------------------------------------
// free — deregister + delete
// ---------------------------------------------------------------------------

async function describeNumber(phoneNumberId) {
  return graph(phoneNumberId, {
    params: {
      fields: "id,display_phone_number,verified_name,platform_type",
    },
  })
}

async function confirm(question) {
  if (flags.yes) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`${question} [escribe "si"] `)
  rl.close()
  return answer.trim().toLowerCase() === "si"
}

async function runFree() {
  const phoneNumberId = positional[1]
  if (!phoneNumberId) {
    fail("Falta el phone_number_id. Sácalo con: node scripts/whatsapp-free-number.mjs list")
  }

  const number = await describeNumber(phoneNumberId)
  console.log(
    `Número ${number.display_phone_number ?? phoneNumberId} «${number.verified_name ?? "—"}»` +
      (number.platform_type ? ` — platform_type: ${number.platform_type}` : "")
  )

  const ok = await confirm(
    "Esto lo saca de Cloud API y lo borra de la WABA. ¿Seguir?"
  )
  if (!ok) {
    console.log("Cancelado.")
    return
  }

  // 1. deregister. El 2FA se activó en el `/register` del flujo estándar con el
  // PIN que generó `finishStandard`; si Meta lo pide, va en --pin (está en la
  // fila de la conexión, campo `pin`).
  process.stdout.write("deregister… ")
  await graph(`${phoneNumberId}/deregister`, {
    method: "POST",
    params: typeof flags.pin === "string" ? { pin: flags.pin } : {},
  })
  console.log("ok")

  if (flags.keep) {
    console.log("--keep: el número queda en la WABA, fuera de Cloud API.")
    return
  }

  // 2. delete. **Best-effort y a propósito**: Graph responde `code 100 subcode
  // 33` («does not support this operation») a un `DELETE` sobre un
  // phone_number_id, así que borrar el número de la WABA es un paso de UI y no
  // de API. No se aborta ni se sale con error: el número ya quedó libre en el
  // paso 1, que es lo único que impedía reusarlo, y presentar esto como un
  // fallo mandaría a alguien a reintentar una limpieza que ya no hace falta.
  process.stdout.write("delete… ")
  try {
    await graph(phoneNumberId, { method: "DELETE" })
    console.log("ok")
  } catch (error) {
    console.log("no disponible por API")
    console.log(
      `  (${error.message})\n` +
        "  El número YA está libre: el `deregister` es el que lo saca de Cloud API.\n" +
        "  Para quitarlo también de la WABA: WhatsApp Manager → Configuración de la\n" +
        "  cuenta → Números de teléfono → Administrar → Eliminar número de teléfono."
    )
  }

  console.log(
    "\nListo. Antes de reusarlo:\n" +
      "  · espera unos minutos, Meta tarda en propagarlo\n" +
      "  · borra la fila de la conexión en tu DB (where channel = 'whatsapp'\n" +
      `    and meta_page_id = '${phoneNumberId}'), no solo la marques desconectada\n` +
      "  · si la WABA era solo de prueba, bórrala del portafolio"
  )
}

// ---------------------------------------------------------------------------

function fail(message) {
  console.error(message)
  process.exit(1)
}

const COMMANDS = { list: runList, free: runFree }

const run = COMMANDS[command]
if (!run) {
  fail(
    "Uso:\n" +
      "  node scripts/whatsapp-free-number.mjs list [--waba <WABA_ID>]\n" +
      "  node scripts/whatsapp-free-number.mjs free <PHONE_NUMBER_ID> [--pin 123456] [--keep] [--yes]\n\n" +
      "Token: WHATSAPP_ADMIN_TOKEN en el entorno, o --token <valor>."
  )
}

// Después del comando a propósito: quien escribe el script sin argumentos
// quiere ver el uso, no un reproche sobre una variable que todavía no sabe que
// necesita.
if (!token || token === true) {
  fail(
    "Falta el token. Exporta WHATSAPP_ADMIN_TOKEN o pasa --token <valor>.\n" +
      "  App Dashboard → WhatsApp → Configuración de la API → token temporal (24 h)."
  )
}

try {
  await run()
} catch (error) {
  fail(`\nFalló: ${error.message}`)
}
