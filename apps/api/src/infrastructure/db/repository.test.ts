import { describe, expect, it } from "vitest"

import type { Sql } from "./client"
import {
  SqlRepository,
  messageDto,
  type MessageRecord,
  type PageRecord,
  type SubscriptionUpsertInput,
} from "./repository"

type Row = Record<string, unknown>

describe("message DTO safety", () => {
  it("replaces a legacy persisted provider error with a controlled indicator", () => {
    const dto = messageDto({
      id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
      tenantId: "6b402566-9e1d-4739-bb61-81ac615a5469",
      conversationId: "9e2327a8-0c42-493e-bd6c-c08ed81010f0",
      pageId: "f251bd5a-2772-489a-a725-43e2ea9d44ee",
      contactId: "psid",
      direction: "outbound",
      status: "failed",
      text: "hello",
      providerMessageId: null,
      error:
        "https://graph.facebook.com/me/messages?access_token=SECRET raw body",
      providerResponse: { token: "SECRET" },
      idempotencyKey: "order-1",
      idempotencyFingerprint: "fingerprint-1",
      createdAt: new Date("2026-07-29T18:00:00.000Z"),
    } satisfies MessageRecord)

    expect(dto.status).toBe("failed")
    expect(dto.failure).toEqual({
      message: "Meta could not deliver this message.",
    })
    expect(JSON.stringify(dto)).not.toMatch(
      /SECRET|access_token|graph\\.facebook|raw body/u
    )
  })
})

describe("outbound idempotency reservation", () => {
  it("acquires the provider-call lease only after inserting a reservation", async () => {
    const repository = new SqlRepository(fakeSql([[], [{ tenant_id: "t1" }]]))
    await expect(
      repository.reserveOutbound({
        tenantId: "t1",
        idempotencyKey: "order-1",
        fingerprint: "fingerprint-1",
      })
    ).resolves.toEqual({ kind: "acquired" })
  })

  it("fails closed for a legacy message without fingerprint", async () => {
    const repository = new SqlRepository(
      fakeSql([
        [
          messageRow({
            idempotency_key: "legacy-key",
            idempotency_fingerprint: null,
          }),
        ],
      ])
    )
    await expect(
      repository.reserveOutbound({
        tenantId: "t1",
        idempotencyKey: "legacy-key",
        fingerprint: "new-fingerprint",
      })
    ).resolves.toEqual({ kind: "conflict", reason: "legacy" })
  })

  it("does not let a concurrent request call the provider", async () => {
    const repository = new SqlRepository(
      fakeSql([
        [],
        [],
        [
          {
            fingerprint: "fingerprint-1",
            state: "processing",
            message_id: null,
          },
        ],
      ])
    )
    await expect(
      repository.reserveOutbound({
        tenantId: "t1",
        idempotencyKey: "order-1",
        fingerprint: "fingerprint-1",
      })
    ).resolves.toEqual({ kind: "conflict", reason: "in_progress" })
  })

  it("replays a completed message only for the same fingerprint", async () => {
    const repository = new SqlRepository(
      fakeSql([
        [
          messageRow({
            idempotency_key: "order-1",
            idempotency_fingerprint: "fingerprint-1",
          }),
        ],
      ])
    )
    const result = await repository.reserveOutbound({
      tenantId: "t1",
      idempotencyKey: "order-1",
      fingerprint: "fingerprint-1",
    })
    expect(result.kind).toBe("replay")
  })
})

describe("RPC Page state and conversation history", () => {
  it("returns all conversation messages across pages in explicit descending order", async () => {
    const rows = Array.from({ length: 101 }, (_, index) =>
      messageRow({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ...(index === 100
          ? {
              status: "failed",
              error: "raw https://graph.facebook.com?access_token=SECRET body",
              provider_response: {
                error: { message: "access_token=SECRET" },
              },
            }
          : {}),
        created_at: new Date(
          Date.parse("2026-07-29T18:00:00.000Z") - index * 1_000
        ).toISOString(),
      })
    )
    const sql = capturingQuerySql([rows, [rows[100] as Row]])
    const repository = new SqlRepository(sql.client)
    const conversationId = "9e2327a8-0c42-493e-bd6c-c08ed81010f0"

    const first = await repository.listConversationMessages(
      "tenant_1",
      conversationId,
      { limit: 100 }
    )
    const second = await repository.listConversationMessages(
      "tenant_1",
      conversationId,
      { limit: 100, cursor: first.pagination.nextCursor ?? undefined }
    )

    expect(first.data).toHaveLength(100)
    expect(first.pagination).toMatchObject({ hasMore: true })
    expect(second.data).toHaveLength(1)
    expect([...first.data, ...second.data]).toHaveLength(101)
    expect(second.data[0]).toMatchObject({
      status: "failed",
      failure: { message: "Meta could not deliver this message." },
    })
    expect(JSON.stringify([...first.data, ...second.data])).not.toMatch(
      /SECRET|access_token|graph\\.facebook|raw body/u
    )
    expect(sql.queries[0]?.statement).toContain(
      "order by created_at desc, id desc"
    )
    expect(sql.queries[1]?.statement).toContain("(created_at, id) <")
  })

  it("maps operational Page state without returning stored credentials", async () => {
    const record = pageRecord()
    const sql = capturingSql([
      [
        {
          id: record.id,
          tenant_id: record.tenantId,
          meta_page_id: record.providerPageId,
          name: record.name,
          status: "disconnected",
          token_status: "invalid",
          token_error: "access_token=SECRET raw provider response",
          token_error_at: "2026-07-29T18:01:00.000Z",
          webhook_url: record.webhookUrl,
          page_access_token_encrypted: "encrypted-token",
          webhook_signing_secret_encrypted: "encrypted-secret",
          connected_at: record.connectedAt,
          disconnected_at: "2026-07-29T18:02:00.000Z",
          updated_at: record.updatedAt,
        },
      ],
    ])

    const [result] = await new SqlRepository(sql.client).listAllPages(
      record.tenantId
    )

    expect(result).toMatchObject({
      tokenError: "The Page credential is invalid. Reconnect the Page.",
      tokenErrorAt: "2026-07-29T18:01:00.000Z",
      disconnectedAt: "2026-07-29T18:02:00.000Z",
    })
    expect(result).not.toHaveProperty("pageAccessTokenEncrypted")
    expect(result).not.toHaveProperty("webhookSigningSecretEncrypted")
    expect(JSON.stringify(result)).not.toMatch(
      /access_token|SECRET|raw provider response/u
    )
  })

  it("does not create or replace a signing secret during connect", async () => {
    const statements: string[] = []
    const record = pageRecord()
    const row = {
      id: record.id,
      tenant_id: record.tenantId,
      meta_page_id: record.providerPageId,
      name: record.name,
      status: record.status,
      token_status: record.tokenStatus,
      token_error: null,
      token_error_at: null,
      webhook_url: record.webhookUrl,
      page_access_token_encrypted: record.pageAccessTokenEncrypted,
      webhook_signing_secret_encrypted: record.webhookSigningSecretEncrypted,
      connected_at: record.connectedAt,
      disconnected_at: null,
      updated_at: record.updatedAt,
    }
    const tagged = async (strings: TemplateStringsArray) => {
      statements.push(strings.join("?"))
      return [row]
    }
    const client = Object.assign(tagged, {
      query: async () => [],
      transaction: async (
        callback: (transaction: typeof tagged) => Promise<Row[]>[]
      ) => Promise.all(callback(tagged)),
    }) as unknown as Sql

    const [connected] = await new SqlRepository(client).connectPages(
      record.tenantId,
      [
        {
          providerPageId: record.providerPageId,
          name: record.name,
          encryptedPageToken: "new-token",
        },
      ]
    )

    const mutation = statements[0]?.split("returning")[0] ?? ""
    expect(mutation).not.toContain("webhook_signing_secret_encrypted")
    expect(connected?.webhookSigningSecretEncrypted).toBe("encrypted-secret")
  })

  it("guards webhook and signing-secret mutations with active Page status", async () => {
    const sql = capturingSql([[], []])
    const repository = new SqlRepository(sql.client)

    await expect(
      repository.updatePageWebhook(
        "tenant_1",
        pageRecord().id,
        "https://example.com/new-hook"
      )
    ).resolves.toBeNull()
    await expect(
      repository.rotateWebhookSecret({
        tenantId: "tenant_1",
        pageId: pageRecord().id,
        encryptedSecret: "encrypted-new-secret",
      })
    ).resolves.toBeNull()

    expect(sql.taggedStatements).toHaveLength(2)
    expect(sql.taggedStatements[0]).toContain("and status = 'active'")
    expect(sql.taggedStatements[1]).toContain("and status = 'active'")
  })
})

describe("subscription persistence ordering", () => {
  it("does not write or clean up for a terminal event from another subscription", async () => {
    const sql = capturingSql([[subscriptionRow()]])
    const repository = new SqlRepository(sql.client)
    await expect(
      repository.upsertSubscription(
        subscriptionInput({
          stripeSubscriptionId: "sub_old",
          status: "canceled",
        })
      )
    ).resolves.toEqual({
      applied: false,
      supersededSubscriptionId: null,
    })
    expect(sql.taggedStatements).toHaveLength(1)
  })

  it("writes a newer terminal event for the same subscription without cleanup", async () => {
    const sql = capturingSql([[subscriptionRow()], []])
    const repository = new SqlRepository(sql.client)
    await expect(
      repository.upsertSubscription(subscriptionInput({ status: "canceled" }))
    ).resolves.toEqual({
      applied: true,
      supersededSubscriptionId: null,
    })
    expect(sql.taggedStatements).toHaveLength(2)
  })

  it("keeps a newer live row and identifies an older live duplicate for cleanup", async () => {
    const sql = capturingSql([[subscriptionRow()]])
    const repository = new SqlRepository(sql.client)
    await expect(
      repository.upsertSubscription(
        subscriptionInput({
          stripeSubscriptionId: "sub_old",
          eventAt: new Date("2026-07-27T00:00:00.000Z"),
        })
      )
    ).resolves.toEqual({
      applied: false,
      supersededSubscriptionId: "sub_old",
    })
    expect(sql.taggedStatements).toHaveLength(1)
  })
})

describe("inbound atomicity and recovery", () => {
  it("persists message, terminal delivery job, and usage in one statement", async () => {
    const sql = capturingSql([
      [
        {
          message_id: "ef55c94e-b861-4d19-9f9b-b5689028de80",
          job_id: "d743db7b-d4b8-4911-bf01-c639816856fc",
          job_status: "failed_permanent",
          job_attempt_count: 0,
          job_recover_after: "2026-07-29T18:02:00.000Z",
        },
      ],
    ])
    const repository = new SqlRepository(sql.client)
    await expect(
      repository.ingestInbound({
        page: pageRecord(),
        contactId: "psid",
        text: "hello",
        providerMessageId: "mid.1",
        eventId: "evt_1",
        createdAt: new Date("2026-07-29T18:00:00.000Z"),
        payloadVersion: 1,
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        deliveryEnabled: false,
        deliveryBlockedReason: "account is restricted: quota_exceeded",
        recoverAfter: new Date("2026-07-29T18:02:00.000Z"),
      })
    ).resolves.toMatchObject({ inserted: true })
    expect(sql.taggedStatements).toHaveLength(1)
    expect(sql.taggedStatements[0]).toContain("inserted_message as")
    expect(sql.taggedStatements[0]).toContain("inserted_job as")
    expect(sql.taggedStatements[0]).toContain("usage_increment as")
  })

  it("fails closed when a DLQ job has no durable terminal row", async () => {
    const repository = new SqlRepository(capturingSql([[], []]).client)
    await expect(
      repository.markJobDead(
        "d743db7b-d4b8-4911-bf01-c639816856fc",
        "retries exhausted"
      )
    ).rejects.toThrow("terminal state was not persisted")
  })

  it("recovers an initially abandoned handoff only when its durable deadline is due", async () => {
    const clock = mutableClock("2026-07-29T18:00:00.000Z")
    const harness = recoverySql([
      recoveryJob({
        recoverAfter: new Date("2026-07-29T18:02:00.000Z"),
      }),
    ])
    const repository = new SqlRepository(harness.client, clock.now)

    clock.set("2026-07-29T18:01:59.999Z")
    await expect(
      repository.findRecoverableJobs({ limit: 100, leaseSeconds: 120 })
    ).resolves.toEqual([])

    clock.set("2026-07-29T18:02:00.000Z")
    await expect(
      repository.findRecoverableJobs({ limit: 100, leaseSeconds: 120 })
    ).resolves.toEqual([{ jobId: "job_1", messageId: "message_1" }])

    await expect(
      repository.findRecoverableJobs({ limit: 100, leaseSeconds: 120 })
    ).resolves.toEqual([])
    expect(harness.jobs[0]?.recoverAfter.toISOString()).toBe(
      "2026-07-29T18:04:00.000Z"
    )
  })

  it.each([300, 900])(
    "respects a %s-second Queue retry plus recovery grace",
    async (retryDelaySeconds) => {
      const clock = mutableClock("2026-07-29T18:00:00.000Z")
      const harness = recoverySql([
        recoveryJob({
          status: "processing",
          attemptCount: retryDelaySeconds === 300 ? 4 : 5,
        }),
      ])
      const repository = new SqlRepository(harness.client, clock.now)
      const job = await repository.getJob("job_1")
      if (!job) throw new Error("expected recovery fixture")

      await repository.recordJobAttempt({
        job,
        outcome: "pending",
        statusCode: 503,
        error: "retry",
        retryDelaySeconds,
        retryGraceSeconds: 120,
      })

      clock.set(
        new Date(
          Date.parse("2026-07-29T18:00:00.000Z") +
            (retryDelaySeconds + 120) * 1000 -
            1
        )
      )
      await expect(
        repository.findRecoverableJobs({ limit: 100, leaseSeconds: 120 })
      ).resolves.toEqual([])

      clock.set(
        new Date(
          Date.parse("2026-07-29T18:00:00.000Z") +
            (retryDelaySeconds + 120) * 1000
        )
      )
      await expect(
        repository.findRecoverableJobs({ limit: 100, leaseSeconds: 120 })
      ).resolves.toEqual([{ jobId: "job_1", messageId: "message_1" }])
    }
  )

  it("recovers stale processing without prematurely duplicating active processing", async () => {
    const clock = mutableClock("2026-07-29T18:00:00.000Z")
    const harness = recoverySql([recoveryJob()])
    const repository = new SqlRepository(harness.client, clock.now)

    await expect(repository.claimJob("job_1", 120)).resolves.toMatchObject({
      status: "processing",
      attemptCount: 1,
      recoverAfter: new Date("2026-07-29T18:02:00.000Z"),
    })

    clock.set("2026-07-29T18:01:59.999Z")
    await expect(
      repository.findRecoverableJobs({ limit: 100, leaseSeconds: 120 })
    ).resolves.toEqual([])

    clock.set("2026-07-29T18:02:00.000Z")
    await expect(
      repository.findRecoverableJobs({ limit: 100, leaseSeconds: 120 })
    ).resolves.toEqual([{ jobId: "job_1", messageId: "message_1" }])
    expect(harness.jobs[0]).toMatchObject({
      status: "pending",
      lastError: "recovered stale processing job",
    })
  })
})

type RecoveryJob = {
  id: string
  eventId: string
  tenantId: string
  messageId: string
  status: "pending" | "processing" | "succeeded" | "failed_permanent" | "dead"
  attemptCount: number
  recoverAfter: Date
  lastError: string | null
}

function recoveryJob(overrides: Partial<RecoveryJob> = {}): RecoveryJob {
  return {
    id: "job_1",
    eventId: "event_1",
    tenantId: "tenant_1",
    messageId: "message_1",
    status: "pending",
    attemptCount: 0,
    recoverAfter: new Date("2026-07-29T18:00:00.000Z"),
    lastError: null,
    ...overrides,
  }
}

function mutableClock(initial: string | Date): {
  now: () => Date
  set: (value: string | Date) => void
} {
  let current = new Date(initial)
  return {
    now: () => new Date(current),
    set: (value) => {
      current = new Date(value)
    },
  }
}

function recoverySql(initialJobs: RecoveryJob[]): {
  client: Sql
  jobs: RecoveryJob[]
} {
  const jobs = initialJobs.map((job) => ({ ...job }))
  const tagged = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Row[]> => {
    const statement = strings.join("?")
    if (
      statement.includes("set status = 'processing'") &&
      statement.includes("attempt_count = attempt_count + 1")
    ) {
      const [recoverAfter, jobId] = values as [Date, string]
      const job = jobs.find(
        (candidate) => candidate.id === jobId && candidate.status === "pending"
      )
      if (!job) return []
      job.status = "processing"
      job.attemptCount += 1
      job.recoverAfter = recoverAfter
      return [{ id: job.id }]
    }
    if (statement.includes("select j.id, j.event_id")) {
      const job = jobs.find((candidate) => candidate.id === values[0])
      return job ? [recoveryRow(job)] : []
    }
    if (statement.includes("insert into external_webhook_deliveries")) {
      return []
    }
    if (
      statement.includes("update external_webhook_jobs") &&
      statement.includes("last_status_code")
    ) {
      const [status, , error, recoverAfter] = values as [
        RecoveryJob["status"],
        number | null,
        string | null,
        Date,
      ]
      const jobId = values.at(-1)
      const job = jobs.find((candidate) => candidate.id === jobId)
      if (!job) return []
      job.status = status
      job.lastError = error
      job.recoverAfter = recoverAfter
      return []
    }
    if (statement.includes("with candidates as")) {
      const [now, limit, leaseUntil] = values as [Date, number, Date]
      return jobs
        .filter(
          (job) =>
            (job.status === "pending" || job.status === "processing") &&
            job.recoverAfter <= now
        )
        .sort(
          (left, right) =>
            left.recoverAfter.getTime() - right.recoverAfter.getTime() ||
            left.id.localeCompare(right.id)
        )
        .slice(0, limit)
        .map((job) => {
          if (job.status === "processing" && !job.lastError) {
            job.lastError = "recovered stale processing job"
          }
          job.status = "pending"
          job.recoverAfter = leaseUntil
          return { id: job.id, message_id: job.messageId }
        })
    }
    throw new Error(`Unexpected recovery SQL: ${statement}`)
  }
  const client = Object.assign(tagged, {
    query: async () => [],
    transaction: async (
      callback: (transaction: typeof tagged) => Promise<Row[]>[]
    ) => Promise.all(callback(tagged)),
  }) as unknown as Sql
  return { client, jobs }
}

function recoveryRow(job: RecoveryJob): Row {
  return {
    id: job.id,
    event_id: job.eventId,
    tenant_id: job.tenantId,
    message_id: job.messageId,
    webhook_url: "https://example.com/webhook",
    payload: { type: "message.received" },
    status: job.status,
    attempt_count: job.attemptCount,
    recover_after: job.recoverAfter,
    webhook_signing_secret_encrypted: "encrypted",
  }
}

function fakeSql(results: Row[][]): Sql {
  const tagged = async () => results.shift() ?? []
  return Object.assign(tagged, {
    query: async () => [],
    transaction: async () => [],
  }) as unknown as Sql
}

function capturingSql(results: Row[][]): {
  client: Sql
  taggedStatements: string[]
} {
  const taggedStatements: string[] = []
  const tagged = async (strings: TemplateStringsArray) => {
    taggedStatements.push(strings.join("?"))
    return results.shift() ?? []
  }
  const client = Object.assign(tagged, {
    query: async () => [],
    transaction: async () => [],
  }) as unknown as Sql
  return { client, taggedStatements }
}

function capturingQuerySql(results: Row[][]): {
  client: Sql
  queries: Array<{ statement: string; parameters: unknown[] }>
} {
  const queries: Array<{ statement: string; parameters: unknown[] }> = []
  const tagged = async () => []
  const client = Object.assign(tagged, {
    query: async (statement: string, parameters: unknown[]) => {
      queries.push({ statement, parameters })
      return results.shift() ?? []
    },
    transaction: async () => [],
  }) as unknown as Sql
  return { client, queries }
}

function messageRow(overrides: Partial<Row>): Row {
  return {
    id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
    tenant_id: "6b402566-9e1d-4739-bb61-81ac615a5469",
    conversation_id: "9e2327a8-0c42-493e-bd6c-c08ed81010f0",
    connected_page_id: "f251bd5a-2772-489a-a725-43e2ea9d44ee",
    contact_id: "psid",
    direction: "outbound",
    status: "sent",
    text: "hello",
    meta_message_id: "mid.1",
    error: null,
    provider_response: null,
    idempotency_key: "order-1",
    idempotency_fingerprint: "fingerprint-1",
    created_at: "2026-07-29T18:00:00.000Z",
    ...overrides,
  }
}

function subscriptionRow(): Row {
  return {
    tenant_id: "tenant_1",
    stripe_subscription_id: "sub_current",
    status: "active",
    price_lookup_key: "starter_monthly",
    current_period_start: "2026-07-01T00:00:00.000Z",
    current_period_end: "2026-08-01T00:00:00.000Z",
    cancel_at_period_end: false,
    last_stripe_event_at: "2026-07-28T00:00:00.000Z",
  }
}

function subscriptionInput(
  overrides: Partial<SubscriptionUpsertInput> = {}
): SubscriptionUpsertInput {
  return {
    tenantId: "tenant_1",
    stripeSubscriptionId: "sub_current",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    eventAt: new Date("2026-07-29T00:00:00.000Z"),
    ...overrides,
  }
}

function pageRecord(): PageRecord {
  return {
    id: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
    tenantId: "6b402566-9e1d-4739-bb61-81ac615a5469",
    providerPageId: "provider_page_1",
    name: "Support",
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenErrorAt: null,
    webhookUrl: "https://example.com/webhook",
    pageAccessTokenEncrypted: "encrypted",
    webhookSigningSecretEncrypted: "encrypted-secret",
    connectedAt: new Date("2026-07-01T00:00:00.000Z"),
    disconnectedAt: null,
    updatedAt: new Date("2026-07-29T00:00:00.000Z"),
  }
}
