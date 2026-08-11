import { describe, expect, it, vi } from "vitest"

import { encryptSecret, hmacHex } from "../infrastructure/crypto/secrets"
import {
  SqlRepository,
  type JobRecord,
  type PageRecord,
  type UserRecord,
} from "../infrastructure/db/repository"
import { RuntimeDatabase } from "../runtime-database.test-helper"
import {
  classifyDeliveryResponse,
  consumeWebhookQueue,
  deliverJob,
  recoverWebhookJobs,
  signedWebhookRequest,
} from "./webhook-delivery"

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")

describe("webhook delivery", () => {
  it.each([200, 201, 204, 299])("acks HTTP %s", (status) => {
    expect(classifyDeliveryResponse(status).kind).toBe("success")
  })

  it.each([408, 429, 500, 503])("retries HTTP %s", (status) => {
    expect(classifyDeliveryResponse(status).kind).toBe("retry")
  })

  it.each([300, 301, 400, 401, 404, 422])(
    "permanently fails HTTP %s",
    (status) => {
      expect(classifyDeliveryResponse(status).kind).toBe("permanent")
    }
  )

  it("signs the exact JSON bytes sent to the customer", async () => {
    const signingSecret = "whsec_test"
    const job: JobRecord = {
      id: "job_1",
      eventId: "evt_1",
      tenantId: "tenant_1",
      messageId: "message_1",
      commentId: null,
      connectionId: "page_1",
      channel: "instagram",
      providerPageId: "17841426388985797",
      username: "lornasuriano",
      webhookUrl: "https://93.184.216.34/hook",
      payload: { z: 1, nested: { text: "hola" } },
      status: "processing",
      attemptCount: 1,
      recoverAfter: new Date("2026-07-29T18:02:00.000Z"),
      signingSecretEncrypted: encryptSecret(ENCRYPTION_KEY, signingSecret),
    }
    const now = new Date("2026-07-29T18:00:00.000Z")
    const { request, rawBody } = await signedWebhookRequest({
      job,
      encryptionKey: ENCRYPTION_KEY,
      now,
    })
    const timestamp = request.headers.get("resender-timestamp")
    const expected = await hmacHex(
      signingSecret,
      `${job.eventId}.${timestamp}.${rawBody}`
    )

    expect(await request.text()).toBe(rawBody)
    expect(request.redirect).toBe("manual")
    expect(request.headers.get("resender-event-id")).toBe(job.eventId)
    expect(request.headers.get("resender-signature")).toBe(`v1=${expected}`)
  })

  it("acks a duplicate Queue message after the job already succeeded", async () => {
    const fetcher = vi.fn<typeof fetch>()
    const result = await deliverJob({
      repository: {
        claimJob: async () => null,
        getJob: async () => job({ status: "succeeded" }),
      } as unknown as SqlRepository,
      jobId: "job_1",
      encryptionKey: ENCRYPTION_KEY,
      fetcher,
    })
    expect(result).toEqual({ disposition: "ack" })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("records network errors and retries only that Queue message", async () => {
    const recordJobAttempt = vi.fn(async () => undefined)
    const result = await deliverJob({
      repository: {
        claimJob: async () => job({ status: "processing" }),
        recordJobAttempt,
      } as unknown as SqlRepository,
      jobId: "job_1",
      encryptionKey: ENCRYPTION_KEY,
      fetcher: vi.fn(async () => {
        throw new Error("network unavailable")
      }),
    })
    expect(result).toMatchObject({ disposition: "retry" })
    expect(recordJobAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "pending", statusCode: null })
    )
  })

  it("records a permanent 4xx and acknowledges it", async () => {
    const recordJobAttempt = vi.fn(async () => undefined)
    const result = await deliverJob({
      repository: {
        claimJob: async () => job({ status: "processing" }),
        recordJobAttempt,
      } as unknown as SqlRepository,
      jobId: "job_1",
      encryptionKey: ENCRYPTION_KEY,
      fetcher: vi.fn(async () => new Response(null, { status: 404 })),
    })
    expect(result).toEqual({ disposition: "ack" })
    expect(recordJobAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed_permanent",
        statusCode: 404,
      })
    )
  })

  it("acks a DLQ message only after persisting the dead state", async () => {
    const markJobDead = vi.fn(async () => undefined)
    const message = queueMessage()
    await consumeWebhookQueue(
      queueBatch(message),
      {} as Env,
      { markJobDead } as unknown as SqlRepository
    )
    expect(markJobDead).toHaveBeenCalledWith(
      "job_1",
      "Cloudflare Queue retries exhausted"
    )
    expect(message.ack).toHaveBeenCalledOnce()
    expect(message.retry).not.toHaveBeenCalled()
  })

  it("retries a DLQ message when the dead-state database write is transiently unavailable", async () => {
    const message = queueMessage()
    await consumeWebhookQueue(
      queueBatch(message),
      {} as Env,
      {
        markJobDead: async () => {
          throw new Error("database unavailable")
        },
      } as unknown as SqlRepository
    )
    expect(message.ack).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 5 })
  })

  it("leases recovered jobs across successful and failed Queue handoffs", async () => {
    let now = new Date("2026-07-29T18:00:00.000Z")
    const database = new RuntimeDatabase(recoveryPage(), recoveryUser(), null)
    database.jobs.push(
      job({
        recoverAfter: new Date("2026-07-29T17:59:59.000Z"),
        attemptCount: 0,
      })
    )
    const repository = new SqlRepository(database.sql, () => new Date(now))
    const send = vi.fn(async () => queueSendResult())
    const environment = {
      WEBHOOK_DELIVERIES: {
        send,
        sendBatch: async () => queueSendResult(),
        metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }),
      },
    } as unknown as Env

    await expect(recoverWebhookJobs(environment, repository)).resolves.toBe(1)
    expect(send).toHaveBeenCalledOnce()
    expect(database.jobs[0]?.recoverAfter).toEqual(
      new Date("2026-07-29T18:02:00.000Z")
    )
    await expect(recoverWebhookJobs(environment, repository)).resolves.toBe(0)

    now = new Date("2026-07-29T18:02:00.000Z")
    send.mockRejectedValueOnce(new Error("Queue unavailable"))
    await expect(recoverWebhookJobs(environment, repository)).rejects.toThrow(
      "Queue unavailable"
    )
    expect(database.jobs[0]?.recoverAfter).toEqual(
      new Date("2026-07-29T18:04:00.000Z")
    )
    await expect(recoverWebhookJobs(environment, repository)).resolves.toBe(0)

    now = new Date("2026-07-29T18:04:00.000Z")
    await expect(recoverWebhookJobs(environment, repository)).resolves.toBe(1)
    expect(send).toHaveBeenCalledTimes(3)
  })
})

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job_1",
    eventId: "evt_1",
    tenantId: "tenant_1",
    messageId: "message_1",
    commentId: null,
    connectionId: "page_1",
    channel: "instagram",
    providerPageId: "17841426388985797",
    username: "lornasuriano",
    webhookUrl: "https://93.184.216.34/hook",
    payload: { type: "message.received" },
    status: "pending",
    attemptCount: 1,
    recoverAfter: new Date("2026-07-29T18:02:00.000Z"),
    signingSecretEncrypted: encryptSecret(ENCRYPTION_KEY, "whsec_test"),
    ...overrides,
  }
}

function queueMessage() {
  return {
    id: "queue_message_1",
    timestamp: new Date(),
    body: { jobId: "job_1", messageId: "message_1" },
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function queueBatch(message: ReturnType<typeof queueMessage>): MessageBatch {
  return {
    queue: "webhook-deliveries-dlq",
    messages: [message],
    metadata: { metrics: { backlogCount: 1, backlogBytes: 1 } },
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  }
}

function recoveryPage(): PageRecord {
  return {
    id: "f251bd5a-2772-489a-a725-43e2ea9d44ee",
    tenantId: "tenant_1",
    channel: "messenger",
    providerPageId: "page_1",
    name: "Page",
    username: null,
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenExpiresAt: null,
    webhookUrl: "https://example.com/webhook",
    pageAccessTokenEncrypted: "encrypted",
    webhookSigningSecretEncrypted: "encrypted",
    connectedAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-29T18:00:00.000Z"),
  }
}

function recoveryUser(): UserRecord {
  return {
    id: "tenant_1",
    email: "person@example.com",
    passwordHash: "hash",
    waitlisted: false,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  }
}

function queueSendResult(): QueueSendResponse {
  return {
    metadata: {
      metrics: {
        backlogCount: 0,
        backlogBytes: 0,
      },
    },
  }
}
