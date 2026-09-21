import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// La bitácora de Logs es SQL escrito a mano —un `insert … select` con upsert,
// facetas con `filter`, un cursor compuesto— y nada de eso se puede probar con
// mocks. Corre contra un Postgres real embebido (PGlite) con la cadena completa
// de migraciones, igual que `db/migrations/migrations.test.ts`.
const db = new PGlite({ extensions: { pgcrypto } })

// El mismo disfraz de `lib/db.ts`: tag de postgres.js sobre un cliente que
// habla `query(texto, params)`.
vi.mock("@/lib/db", () => ({
  getSql: () => (strings: TemplateStringsArray, ...params: unknown[]) =>
    db
      .query(
        strings.reduce(
          (text, part, index) => `${text}$${index}${part}`
        ),
        params
      )
      .then((result) => result.rows),
}))

const logMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: logMock,
}))

const { parseLogFilters } = await import("./log-filters")
const { countRequestLogFacets, getRequestLog, listRequestLogs } = await import(
  "./read-model"
)
const {
  logApiRequest,
  logDeliveryAttempt,
  logDeliveryDead,
  logDeliveryOutcome,
  logInboundEvent,
  purgeExpiredRequestLogs,
} = await import("./request-log")

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations"
)

let tenantId: string
let otherTenantId: string
let pageId: string
let conversationId: string
let clientAccountId: string

const ALL = { kind: "all" } as const

function account() {
  return {
    id: pageId,
    tenantId,
    clientAccountId: null,
    channel: "messenger" as const,
    metaPageId: "page_1",
    name: "Clínica Sonrisa",
    username: null,
  }
}

function filters(params: Record<string, string> = {}) {
  return parseLogFilters(params, [pageId])
}

async function insertMessage(metaMessageId: string) {
  const result = await db.query<{ id: string }>(
    `insert into messages (
       tenant_id, conversation_id, connected_page_id, contact_id, direction,
       status, text, meta_message_id
     )
     values ($1, $2, $3, 'psid_1', 'inbound', 'received', 'hola', $4)
     returning id`,
    [tenantId, conversationId, pageId, metaMessageId]
  )
  return result.rows[0]!.id
}

async function insertJob(messageId: string) {
  const result = await db.query<{ id: string }>(
    `insert into external_webhook_jobs (
       event_id, tenant_id, message_id, webhook_url, payload, status,
       recover_after
     )
     values ($1, $2, $3, 'https://bot.example/hook', '{}', 'pending', now())
     returning id`,
    [`evt_${messageId.replace(/-/g, "")}`, tenantId, messageId]
  )
  return result.rows[0]!.id
}

beforeAll(async () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  }

  const users = await db.query<{ id: string }>(
    `insert into users (email) values ('padre@example.com'), ('otro@example.com')
     returning id`
  )
  tenantId = users.rows[0]!.id
  otherTenantId = users.rows[1]!.id

  const page = await db.query<{ id: string }>(
    `insert into connected_pages (
       tenant_id, meta_page_id, name, page_access_token_encrypted
     )
     values ($1, 'page_1', 'Clínica Sonrisa', 'enc') returning id`,
    [tenantId]
  )
  pageId = page.rows[0]!.id

  const conversation = await db.query<{ id: string }>(
    `insert into conversations (tenant_id, connected_page_id, contact_id)
     values ($1, $2, 'psid_1') returning id`,
    [tenantId, pageId]
  )
  conversationId = conversation.rows[0]!.id

  const client = await db.query<{ id: string }>(
    `insert into client_accounts (tenant_id, name, max_connections)
     values ($1, 'Cliente Uno', 1) returning id`,
    [tenantId]
  )
  clientAccountId = client.rows[0]!.id
}, 60_000)

beforeEach(async () => {
  logMock.mockClear()
  await db.exec(
    "delete from request_logs; delete from external_webhook_jobs; delete from messages;"
  )
})

describe("escritura", () => {
  it("guarda un entrante de Meta con su fragmento y el resultado", async () => {
    const messageId = await insertMessage("mid.1")
    await logInboundEvent({
      account: account(),
      route: "/api/meta/webhook",
      requestId: "req-1",
      eventType: "message",
      result: { kind: "ingested", forwarding: "queued" },
      startedAt: Date.now() - 12,
      payload: { id: "page_1", messaging: [{ message: { mid: "mid.1" } }] },
      messageId,
      conversationId,
      providerMessageId: "mid.1",
      contactId: "psid_1",
    })

    const { rows } = await listRequestLogs({
      tenantId,
      filters: filters(),
      clientFilter: ALL,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      direction: "meta_to_resender",
      status: "success",
      httpStatus: 200,
      accountName: "Clínica Sonrisa",
      accountExternalId: "page_1",
    })

    const detail = await getRequestLog(tenantId, rows[0]!.id)
    expect(JSON.parse(detail!.requestBody!)).toEqual({
      id: "page_1",
      messaging: [{ message: { mid: "mid.1" } }],
    })
    expect(JSON.parse(detail!.responseBody!)).toMatchObject({
      result: "ingested",
      forwarding: "queued",
    })
    expect(detail!.conversationExists).toBe(true)
    expect(logMock).not.toHaveBeenCalled()
  })

  it("un acuse failed de WhatsApp queda como failed con el motivo de Meta", async () => {
    await logInboundEvent({
      account: account(),
      route: "/api/meta/whatsapp/webhook",
      requestId: "req-2",
      eventType: "status",
      result: { kind: "status_applied", deliveryStatus: "failed" },
      startedAt: Date.now(),
      payload: {},
      providerMessageId: "wamid.1",
      errorCode: "131047",
      errorMessage: "Re-engagement message",
    })
    const { rows } = await listRequestLogs({
      tenantId,
      filters: filters({ estado: "failed" }),
      clientFilter: ALL,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.eventType).toBe("status")
  })

  it("una entrega es una sola fila que se pisa en cada intento", async () => {
    const messageId = await insertMessage("mid.2")
    const jobId = await insertJob(messageId)
    const attempt = {
      jobId,
      tenantId,
      maxAttempts: 6,
      signed: true,
      requestBody: '{"type":"message"}',
    }

    await logDeliveryAttempt({
      ...attempt,
      status: "retrying",
      httpStatus: 502,
      durationMs: 5000,
      attempt: 1,
      retryDelaySeconds: 5,
      error: "Webhook responded with HTTP 502.",
      responseBody: "bad gateway",
    })
    await logDeliveryAttempt({
      ...attempt,
      status: "success",
      httpStatus: 200,
      durationMs: 180,
      attempt: 2,
      retryDelaySeconds: null,
      error: null,
      responseBody: '{"ok":true}',
    })

    const { rows } = await listRequestLogs({
      tenantId,
      filters: filters(),
      clientFilter: ALL,
    })
    expect(rows).toHaveLength(1)
    const detail = await getRequestLog(tenantId, rows[0]!.id)
    expect(detail).toMatchObject({
      direction: "resender_to_bot",
      status: "success",
      httpStatus: 200,
      endpoint: "https://bot.example/hook",
      attemptCount: 2,
      maxAttempts: 6,
      nextRetryAt: null,
      signed: true,
      errorMessage: null,
      responseBody: '{"ok":true}',
      messageId,
      conversationId,
      providerMessageId: "mid.2",
      contactId: "psid_1",
    })
    expect(logMock).not.toHaveBeenCalled()
  })

  it("la DLQ cierra como failed una entrega que seguía reintentando", async () => {
    const jobId = await insertJob(await insertMessage("mid.3"))
    await logDeliveryAttempt({
      jobId,
      tenantId,
      status: "retrying",
      httpStatus: null,
      durationMs: 5000,
      attempt: 6,
      maxAttempts: 6,
      retryDelaySeconds: 900,
      signed: false,
      error: "timeout",
      requestBody: "{}",
      responseBody: null,
    })
    await logDeliveryDead(jobId, "Cloudflare Queue retries exhausted")

    const { rows } = await listRequestLogs({
      tenantId,
      filters: filters(),
      clientFilter: ALL,
    })
    const detail = await getRequestLog(tenantId, rows[0]!.id)
    expect(detail).toMatchObject({
      status: "failed",
      nextRetryAt: null,
      errorMessage: "Cloudflare Queue retries exhausted",
    })
  })

  it("un reenvío omitido queda como skipped con su motivo", async () => {
    const messageId = await insertMessage("mid.4")
    await logDeliveryOutcome({
      subject: { kind: "message", id: messageId },
      status: "skipped",
      webhookUrl: null,
      eventId: "evt_x",
      skipReason: "connection_paused",
      requestBody: { type: "message" },
    })
    const { rows } = await listRequestLogs({
      tenantId,
      filters: filters({ estado: "skipped" }),
      clientFilter: ALL,
    })
    expect(rows).toHaveLength(1)
    const detail = await getRequestLog(tenantId, rows[0]!.id)
    expect(detail).toMatchObject({
      direction: "resender_to_bot",
      skipReason: "connection_paused",
      accountName: "Clínica Sonrisa",
      conversationId,
    })
    expect(logMock).not.toHaveBeenCalled()
  })

  it("una escritura que falla no lanza: deja la línea y sigue", async () => {
    await expect(
      logApiRequest({
        // Un tenant que no existe viola la FK.
        tenantId: "00000000-0000-4000-8000-000000000000",
        channel: "messenger",
        eventType: "send",
        method: "POST",
        endpoint: "/api/meta/send",
        httpStatus: 200,
        durationMs: 10,
        requestId: "req",
        account: null,
        messageId: null,
        instagramCommentId: null,
        conversationId: null,
        providerMessageId: null,
        contactId: null,
        errorCode: null,
        errorMessage: null,
        requestBody: null,
        responseBody: null,
      })
    ).resolves.toBeUndefined()
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "request_log_write",
        outcome: "failed",
      })
    )
  })
})

describe("lectura", () => {
  async function seedApi(input: {
    status: number
    channel?: "messenger" | "instagram" | "whatsapp"
    tenant?: string
    client?: string | null
    providerMessageId?: string | null
    error?: string | null
  }) {
    await logApiRequest({
      tenantId: input.tenant ?? tenantId,
      channel: input.channel ?? "messenger",
      eventType: "send",
      method: "POST",
      endpoint: "/api/meta/send",
      httpStatus: input.status,
      durationMs: 100,
      requestId: "req",
      account:
        input.tenant && input.tenant !== tenantId
          ? null
          : { ...account(), clientAccountId: input.client ?? null },
      messageId: null,
      instagramCommentId: null,
      conversationId: null,
      providerMessageId: input.providerMessageId ?? null,
      contactId: "psid_1",
      errorCode: null,
      errorMessage: input.error ?? null,
      requestBody: "{}",
      responseBody: "{}",
    })
  }

  it("aísla por tenant, filtra y cuenta cada faceta sin su propio filtro", async () => {
    await seedApi({ status: 200 })
    await seedApi({ status: 200, channel: "whatsapp" })
    await seedApi({ status: 400, error: "Meta rechazó: token vencido" })
    await seedApi({ status: 502 })
    await seedApi({ status: 200, tenant: otherTenantId })

    const all = await listRequestLogs({
      tenantId,
      filters: filters(),
      clientFilter: ALL,
    })
    expect(all.rows).toHaveLength(4)

    const failed = filters({ estado: "failed" })
    expect(
      (await listRequestLogs({ tenantId, filters: failed, clientFilter: ALL }))
        .rows
    ).toHaveLength(2)
    // Con «Failed» tildado, «Success» sigue mostrando su conteo real.
    expect(
      await countRequestLogFacets({
        tenantId,
        filters: failed,
        clientFilter: ALL,
      })
    ).toEqual({
      status: { success: 2, failed: 2, retrying: 0, skipped: 0 },
      direction: { meta_to_resender: 0, resender_to_bot: 0, bot_to_resender: 2 },
    })

    const combos: Array<[Record<string, string>, number]> = [
      [{ http: "5xx" }, 1],
      [{ http: "4xx" }, 1],
      [{ plataforma: "whatsapp" }, 1],
      [{ dir: "meta_to_resender" }, 0],
      [{ q: "token vencido" }, 1],
      [{ q: "100%_literal" }, 0],
      [{ cuenta: pageId }, 4],
    ]
    for (const [params, expected] of combos) {
      const result = await listRequestLogs({
        tenantId,
        filters: filters(params),
        clientFilter: ALL,
      })
      expect(result.rows, JSON.stringify(params)).toHaveLength(expected)
    }
  })

  it("filtra por cliente y por «propias»", async () => {
    await seedApi({ status: 200 })
    await seedApi({ status: 200, client: clientAccountId })

    const own = await listRequestLogs({
      tenantId,
      filters: filters(),
      clientFilter: { kind: "own" },
    })
    expect(own.rows).toHaveLength(1)
    expect(own.rows[0]!.clientAccountId).toBeNull()

    const client = await listRequestLogs({
      tenantId,
      filters: filters(),
      clientFilter: { kind: "client", clientAccountId },
    })
    expect(client.rows).toHaveLength(1)
    expect(client.rows[0]!.clientAccountId).toBe(clientAccountId)
  })

  it("pagina con cursor sin saltar ni repetir filas", async () => {
    for (let index = 0; index < 5; index++) await seedApi({ status: 200 })

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page: Awaited<ReturnType<typeof listRequestLogs>> =
        await listRequestLogs({
          tenantId,
          filters: filters(),
          clientFilter: ALL,
          cursor,
          limit: 2,
        })
      seen.push(...page.rows.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor)

    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
  })

  it("«ver relacionados» junta el envío con sus acuses, fuera del período", async () => {
    await seedApi({ status: 200, providerMessageId: "wamid.9" })
    await seedApi({ status: 200, providerMessageId: "wamid.otro" })
    await logInboundEvent({
      account: account(),
      route: "/api/meta/whatsapp/webhook",
      requestId: "req",
      eventType: "status",
      result: { kind: "status_applied", deliveryStatus: "delivered" },
      startedAt: Date.now(),
      payload: {},
      providerMessageId: "wamid.9",
    })
    // El acuse es de hace tres días: fuera de las 24 h por defecto.
    await db.exec(
      "update request_logs set created_at = now() - interval '3 days' where event_type = 'status'"
    )

    const send = (
      await listRequestLogs({
        tenantId,
        filters: filters({ q: "wamid.9" }),
        clientFilter: ALL,
      })
    ).rows[0]!
    const related = await listRequestLogs({
      tenantId,
      filters: filters({ rel: send.id }),
      clientFilter: ALL,
    })
    expect(related.rows.map((row) => row.eventType).sort()).toEqual([
      "send",
      "status",
    ])
  })

  it("el detalle de otro tenant no existe", async () => {
    await seedApi({ status: 200, tenant: otherTenantId })
    const foreign = await db.query<{ id: string }>(
      "select id from request_logs where tenant_id = $1",
      [otherTenantId]
    )
    expect(await getRequestLog(tenantId, foreign.rows[0]!.id)).toBeNull()
  })
})

describe("retención", () => {
  it("borra lo que pasó los 30 días y deja el resto", async () => {
    const messageId = await insertMessage("mid.r")
    for (const requestId of ["viejo", "nuevo"]) {
      await logInboundEvent({
        account: account(),
        route: "/api/meta/webhook",
        requestId,
        eventType: "message",
        result: { kind: "ingested", forwarding: "queued" },
        startedAt: Date.now(),
        payload: {},
        messageId,
      })
    }
    await db.exec(
      "update request_logs set created_at = now() - interval '31 days' where request_id = 'viejo'"
    )

    expect(await purgeExpiredRequestLogs()).toBe(1)
    const left = await db.query<{ request_id: string }>(
      "select request_id from request_logs"
    )
    expect(left.rows.map((row) => row.request_id)).toEqual(["nuevo"])
  })

  it("los logs sobreviven a la desconexión de la cuenta", async () => {
    const page = await db.query<{ id: string }>(
      `insert into connected_pages (
         tenant_id, meta_page_id, name, page_access_token_encrypted
       )
       values ($1, 'page_tmp', 'Temporal', 'enc') returning id`,
      [tenantId]
    )
    await logApiRequest({
      tenantId,
      channel: "messenger",
      eventType: "send",
      method: "POST",
      endpoint: "/api/meta/send",
      httpStatus: 200,
      durationMs: 1,
      requestId: "req",
      account: {
        ...account(),
        id: page.rows[0]!.id,
        name: "Temporal",
        metaPageId: "page_tmp",
      },
      messageId: null,
      instagramCommentId: null,
      conversationId: null,
      providerMessageId: null,
      contactId: null,
      errorCode: null,
      errorMessage: null,
      requestBody: null,
      responseBody: null,
    })
    await db.query("delete from connected_pages where id = $1", [
      page.rows[0]!.id,
    ])

    const { rows } = await listRequestLogs({
      tenantId,
      filters: filters(),
      clientFilter: ALL,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.accountName).toBe("Temporal")
  })
})
