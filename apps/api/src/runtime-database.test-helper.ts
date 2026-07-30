import type { Sql } from "./infrastructure/db/client"
import type {
  JobRecord,
  PageRecord,
  SubscriptionRecord,
  UserRecord,
} from "./infrastructure/db/repository"

type Row = Record<string, unknown>

type StoredInbound = {
  id: string
  pageId: string
  providerMessageId: string
  text: string
}

export class RuntimeDatabase {
  readonly messages: StoredInbound[] = []
  readonly jobs: JobRecord[] = []
  inboundInsertStatements = 0
  subscriptionWrites = 0
  usage = 0
  subscription: SubscriptionRecord | null

  constructor(
    readonly page: PageRecord,
    readonly user: UserRecord,
    subscription: SubscriptionRecord | null
  ) {
    this.subscription = subscription
  }

  readonly sql = Object.assign(
    async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<Row[]> => this.execute(strings.join("?"), values),
    {
      query: async (): Promise<Row[]> => [],
      transaction: async (
        callback: (
          transaction: (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => Promise<Row[]>
        ) => Promise<Row[]>[]
      ): Promise<Row[][]> =>
        Promise.all(
          callback(async (strings, ...values) =>
            this.execute(strings.join("?"), values)
          )
        ),
    }
  ) as unknown as Sql

  private async execute(statement: string, values: unknown[]): Promise<Row[]> {
    if (
      statement.includes("from connected_pages") &&
      statement.includes("where meta_page_id =")
    ) {
      return values[0] === this.page.providerPageId ? [pageRow(this.page)] : []
    }
    if (
      statement.includes("from users") &&
      statement.includes("where id =") &&
      statement.includes("password_hash")
    ) {
      return values[0] === this.user.id ? [userRow(this.user)] : []
    }
    if (
      statement.includes("from subscriptions") &&
      statement.includes("where tenant_id =")
    ) {
      return this.subscription && values[0] === this.subscription.tenantId
        ? [subscriptionRow(this.subscription)]
        : []
    }
    if (
      statement.includes("select count(*)::int as count") &&
      statement.includes("from connected_pages")
    ) {
      return [{ count: values[0] === this.page.tenantId ? 1 : 0 }]
    }
    if (
      statement.includes("select message_count") &&
      statement.includes("from usage_counters")
    ) {
      return [{ message_count: this.usage }]
    }
    if (statement.includes("with conversation as")) {
      this.inboundInsertStatements += 1
      return this.executeInboundCte(values)
    }
    if (
      statement.includes("join external_webhook_jobs") &&
      statement.includes("m.meta_message_id")
    ) {
      const message = this.messages.find(
        (candidate) =>
          candidate.pageId === values[0] &&
          candidate.providerMessageId === values[1]
      )
      if (!message) return []
      const job = this.jobs.find(
        (candidate) => candidate.messageId === message.id
      )
      return job
        ? [
            {
              message_id: message.id,
              job_id: job.id,
              job_status: job.status,
              job_attempt_count: job.attemptCount,
              job_recover_after: job.recoverAfter,
            },
          ]
        : []
    }
    if (statement.includes("insert into subscriptions")) {
      this.subscriptionWrites += 1
      this.subscription = {
        tenantId: stringValue(values[0]),
        stripeSubscriptionId: stringValue(values[1]),
        status: stringValue(values[2]),
        priceLookupKey: stringValue(values[3]),
        currentPeriodStart: nullableDate(values[4]),
        currentPeriodEnd: nullableDate(values[5]),
        cancelAtPeriodEnd: values[6] === true,
        lastStripeEventAt: dateValue(values[7]),
      }
      return []
    }
    if (statement.includes("with candidates as")) {
      const now = dateValue(values[0])
      const limit = numberValue(values[1])
      const leaseUntil = dateValue(values[2])
      return this.jobs
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
          job.status = "pending"
          job.recoverAfter = leaseUntil
          return { id: job.id, message_id: job.messageId }
        })
    }
    throw new Error(`Unexpected runtime database statement: ${statement}`)
  }

  private executeInboundCte(values: unknown[]): Row[] {
    const providerMessageId = stringValue(values[8])
    // This is the transport fake's equivalent of the database uniqueness
    // constraint. Whether the repository performs its follow-up lookup and
    // Queue handoff remains production behavior under test.
    if (
      this.messages.some(
        (message) =>
          message.pageId === this.page.id &&
          message.providerMessageId === providerMessageId
      )
    ) {
      return []
    }
    const index = this.messages.length + 1
    const messageId = uuidFor(index)
    const jobId = uuidFor(index + 100)
    const deliveryEnabled = values[23] === true
    const status: JobRecord["status"] =
      deliveryEnabled && this.page.webhookUrl ? "pending" : "failed_permanent"
    this.messages.push({
      id: messageId,
      pageId: this.page.id,
      providerMessageId,
      text: stringValue(values[7]),
    })
    this.jobs.push({
      id: jobId,
      eventId: stringValue(values[10]),
      tenantId: this.page.tenantId,
      messageId,
      webhookUrl: this.page.webhookUrl,
      payload: {
        id: stringValue(values[10]),
        type: "message.received",
      },
      status,
      attemptCount: 0,
      recoverAfter: dateValue(values[28]),
      signingSecretEncrypted: this.page.webhookSigningSecretEncrypted,
    })
    this.usage += 1
    return [
      {
        message_id: messageId,
        job_id: jobId,
        job_status: status,
        job_attempt_count: 0,
        job_recover_after: dateValue(values[28]),
      },
    ]
  }
}

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
}

function pageRow(page: PageRecord): Row {
  return {
    id: page.id,
    tenant_id: page.tenantId,
    meta_page_id: page.providerPageId,
    name: page.name,
    status: page.status,
    token_status: page.tokenStatus,
    token_error: page.tokenError,
    token_error_at: page.tokenErrorAt,
    webhook_url: page.webhookUrl,
    page_access_token_encrypted: page.pageAccessTokenEncrypted,
    webhook_signing_secret_encrypted: page.webhookSigningSecretEncrypted,
    connected_at: page.connectedAt,
    disconnected_at: page.disconnectedAt,
    updated_at: page.updatedAt,
  }
}

function userRow(user: UserRecord): Row {
  return {
    id: user.id,
    email: user.email,
    password_hash: user.passwordHash,
    waitlisted: user.waitlisted,
    created_at: user.createdAt,
  }
}

function subscriptionRow(subscription: SubscriptionRecord): Row {
  return {
    tenant_id: subscription.tenantId,
    stripe_subscription_id: subscription.stripeSubscriptionId,
    status: subscription.status,
    price_lookup_key: subscription.priceLookupKey,
    current_period_start: subscription.currentPeriodStart,
    current_period_end: subscription.currentPeriodEnd,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    last_stripe_event_at: subscription.lastStripeEventAt,
  }
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string SQL value")
  return value
}

function numberValue(value: unknown): number {
  if (typeof value !== "number") throw new Error("Expected number SQL value")
  return value
}

function dateValue(value: unknown): Date {
  if (!(value instanceof Date)) throw new Error("Expected Date SQL value")
  return value
}

function nullableDate(value: unknown): Date | null {
  return value === null ? null : dateValue(value)
}
