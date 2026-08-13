import { describe, expect, it } from "vitest"

import type { Sql } from "./client"
import {
  SqlRepository,
  type PageRecord,
  type SubscriptionUpsertInput,
} from "./repository"

type Row = Record<string, unknown>

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
    ).resolves.toEqual([
      { jobId: "job_1", messageId: "message_1", commentId: null },
    ])

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
      ).resolves.toEqual([
        { jobId: "job_1", messageId: "message_1", commentId: null },
      ])
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
    ).resolves.toEqual([
      { jobId: "job_1", messageId: "message_1", commentId: null },
    ])
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
    // La cuenta de la que cuelga el job: sale del join a `connected_pages` que
    // `getJob` ya hacía, y es lo que permite que el log de la entrega diga de
    // qué cuenta se trata y no solo de qué tenant.
    connected_page_id: "f251bd5a-2772-489a-a725-43e2ea9d44ee",
    channel: "messenger",
    meta_page_id: "104233889761204",
    username: null,
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
    channel: "messenger",
    providerPageId: "provider_page_1",
    name: "Support",
    username: null,
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenExpiresAt: null,
    webhookUrl: "https://example.com/webhook",
    pageAccessTokenEncrypted: "encrypted",
    webhookSigningSecretEncrypted: "encrypted-secret",
    wabaId: null,
    phoneE164: null,
    onboardingMode: null,
    coexistenceStatus: null,
    historySyncStatus: null,
    connectedAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-29T00:00:00.000Z"),
  }
}
