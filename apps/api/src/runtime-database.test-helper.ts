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
  // La 0015 reparte el dedupe de WhatsApp en dos índices parciales por
  // dirección: el mismo wamid puede existir una vez como entrante y otra como
  // saliente. Messenger e Instagram solo persisten entrantes por esta vía.
  direction: "inbound" | "outbound"
  text: string
}

type StoredContactSync = {
  pageId: string
  phoneNumber: string
  action: "add" | "remove"
}

type StoredComment = {
  id: string
  pageId: string
  providerCommentId: string
  direction: "inbound" | "outbound"
  text: string
}

export class RuntimeDatabase {
  readonly messages: StoredInbound[] = []
  readonly comments: StoredComment[] = []
  readonly jobs: JobRecord[] = []
  readonly contactSyncs: StoredContactSync[] = []
  // Estado de entrega por `meta_message_id`. Vive aparte de `messages` porque
  // lo escribe un callback distinto y así se puede afirmar sobre la
  // monotonicidad sin tocar la fila del mensaje.
  readonly deliveryStatuses = new Map<string, string>()
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
      // El canal viaja como segundo parámetro desde la 0013: `meta_page_id`
      // solo es único dentro de un canal, así que el fake tiene que filtrar
      // igual que la consulta real o dejaría pasar una resolución ambigua.
      const channelMatches =
        !statement.includes("and channel =") || values[1] === this.page.channel
      return values[0] === this.page.providerPageId && channelMatches
        ? [pageRow(this.page)]
        : []
    }
    if (
      statement.includes("from instagram_comments") &&
      statement.includes("direction = 'outbound'")
    ) {
      return this.comments.some(
        (comment) =>
          comment.pageId === values[0] &&
          comment.providerCommentId === values[1] &&
          comment.direction === "outbound"
      )
        ? [{ id: "own" }]
        : []
    }
    if (statement.includes("with inserted_comment as")) {
      return this.executeCommentCte(values)
    }
    if (
      statement.includes("join external_webhook_jobs") &&
      statement.includes("c.ig_comment_id")
    ) {
      const comment = this.comments.find(
        (candidate) =>
          candidate.pageId === values[0] &&
          candidate.providerCommentId === values[1]
      )
      const job = comment
        ? this.jobs.find((candidate) => candidate.commentId === comment.id)
        : undefined
      return comment && job
        ? [
            {
              comment_id: comment.id,
              job_id: job.id,
              job_status: job.status,
              job_attempt_count: job.attemptCount,
            },
          ]
        : []
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
    // Antes de la rama de `with conversation as`: el CTE de WhatsApp empieza
    // igual que el de `ingestInbound` y solo se distingue por las tablas que
    // únicamente él escribe. Indexar sus binds junto a los de Messenger sería
    // el error de siempre, así que va en su propio ejecutor.
    if (statement.includes("insert into whatsapp_media_jobs")) {
      this.inboundInsertStatements += 1
      return this.executeWhatsappCte(values)
    }
    if (statement.includes("with conversation as")) {
      this.inboundInsertStatements += 1
      return this.executeInboundCte(values)
    }
    // Antes de la relectura de Messenger, que la contiene como substring: la de
    // WhatsApp usa `left join` —un histórico se persiste sin job— y acota por
    // dirección con un bind en vez del literal 'inbound'.
    if (statement.includes("left join external_webhook_jobs j on j.message_id")) {
      const direction = stringValue(values[2])
      const message = this.messages.find(
        (candidate) =>
          candidate.pageId === values[0] &&
          candidate.providerMessageId === values[1] &&
          candidate.direction === direction
      )
      if (!message) return []
      const job = this.jobs.find(
        (candidate) => candidate.messageId === message.id
      )
      return [
        {
          message_id: message.id,
          job_id: job?.id ?? null,
          job_status: job?.status ?? null,
          job_attempt_count: job?.attemptCount ?? null,
          job_recover_after: job?.recoverAfter ?? null,
        },
      ]
    }
    // `applyWhatsappStatus`. El rank de estados se repite acá porque el punto
    // de la prueba de integración es justamente que un `sent` rezagado no pise
    // un `read` ya escrito.
    if (
      statement.includes("with target as") &&
      statement.includes("update messages")
    ) {
      const message = this.messages.find(
        (candidate) =>
          candidate.pageId === values[0] &&
          candidate.providerMessageId === values[1]
      )
      // Un wamid que no es nuestro no devuelve fila y no es un error.
      if (!message) return []
      const current = this.deliveryStatuses.get(message.providerMessageId)
      const next = stringValue(values[2])
      const applied = statusRank(next) > statusRank(current)
      if (applied) this.deliveryStatuses.set(message.providerMessageId, next)
      return [
        {
          message_id: message.id,
          current_status: current ?? null,
          applied_status: applied ? next : null,
        },
      ]
    }
    // `applyWhatsappContactSync`. No crea conversaciones: el sync trae la agenda
    // entera del teléfono y materializarla serían cientos de hilos vacíos.
    if (
      statement.includes("update conversations") &&
      statement.includes("contact_synced_at")
    ) {
      this.contactSyncs.push({
        pageId: stringValue(values[3]),
        phoneNumber: stringValue(values[4]),
        action: values[0] === true ? "remove" : "add",
      })
      // Sin tabla de conversaciones en el fake, se responde lo que responde la
      // base cuando el contacto sí tiene hilo: una fila tocada.
      return [{ id: "conversation" }]
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
          return {
            id: job.id,
            message_id: job.messageId,
            instagram_comment_id: job.commentId,
          }
        })
    }
    throw new Error(`Unexpected runtime database statement: ${statement}`)
  }

  private executeInboundCte(values: unknown[]): Row[] {
    const providerMessageId = stringValue(values[9])
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
    const deliveryEnabled = values[26] === true
    const status: JobRecord["status"] =
      deliveryEnabled && this.page.webhookUrl ? "pending" : "failed_permanent"
    this.messages.push({
      id: messageId,
      pageId: this.page.id,
      providerMessageId,
      direction: "inbound",
      text: stringValue(values[8]),
    })
    this.jobs.push({
      id: jobId,
      eventId: stringValue(values[11]),
      tenantId: this.page.tenantId,
      messageId,
      commentId: null,
      connectionId: this.page.id,
      channel: this.page.channel,
      providerPageId: this.page.providerPageId,
      username: this.page.username,
      webhookUrl: this.page.webhookUrl,
      payload: {
        id: stringValue(values[11]),
        type: "message.received",
      },
      status,
      attemptCount: 0,
      recoverAfter: dateValue(values[31]),
      signingSecretEncrypted: this.page.webhookSigningSecretEncrypted,
    })
    // El CTE real trae un where sobre periodStart is not null: sin
    // período no hay contador que incrementar, que es exactamente el caso de
    // Instagram.
    if (values[33] !== null && values[33] !== undefined) this.usage += 1
    return [
      {
        message_id: messageId,
        job_id: jobId,
        job_status: status,
        job_attempt_count: 0,
        job_recover_after: dateValue(values[31]),
      },
    ]
  }

  // El CTE de la 0015. Los binds están en otras posiciones que los de
  // `executeInboundCte` —trae adjuntos, dirección y origen— y por eso se indexan
  // aparte en vez de ampliar aquél.
  private executeWhatsappCte(values: unknown[]): Row[] {
    const providerMessageId = stringValue(values[18])
    const direction = values[9] === "outbound" ? "outbound" : "inbound"
    if (
      this.messages.some(
        (message) =>
          message.pageId === this.page.id &&
          message.providerMessageId === providerMessageId &&
          message.direction === direction
      )
    ) {
      return []
    }
    const historical = values[15] === true
    const index = this.messages.length + 1
    const messageId = uuidFor(index)
    const jobId = uuidFor(index + 100)
    const deliveryEnabled = values[51] === true
    const status: JobRecord["status"] =
      deliveryEnabled && this.page.webhookUrl ? "pending" : "failed_permanent"
    this.messages.push({
      id: messageId,
      pageId: this.page.id,
      providerMessageId,
      direction,
      text: typeof values[12] === "string" ? values[12] : "",
    })
    // `where not historical` en el CTE del job: importar el historial no genera
    // entrega, así que no hay job que encolar y el servicio lo lee por
    // `jobId: null`.
    if (!historical) {
      this.jobs.push({
        id: jobId,
        eventId: stringValue(values[24]),
        tenantId: this.page.tenantId,
        messageId,
        commentId: null,
        connectionId: this.page.id,
        channel: this.page.channel,
        providerPageId: this.page.providerPageId,
        username: this.page.username,
        webhookUrl: this.page.webhookUrl,
        payload: { id: stringValue(values[24]), type: "message.received" },
        status,
        attemptCount: 0,
        recoverAfter: dateValue(values[56]),
        signingSecretEncrypted: this.page.webhookSigningSecretEncrypted,
      })
    }
    // Mismo guard doble que el CTE real: sin período no hay contador, y el
    // historial no consume cuota aunque el período venga informado.
    if (values[59] !== null && values[59] !== undefined && !historical) {
      this.usage += 1
    }
    return [
      {
        message_id: messageId,
        job_id: historical ? null : jobId,
        job_status: historical ? null : status,
        job_attempt_count: historical ? null : 0,
        job_recover_after: historical ? null : dateValue(values[56]),
      },
    ]
  }

  private executeCommentCte(values: unknown[]): Row[] {
    const providerCommentId = stringValue(values[2])
    if (
      this.comments.some(
        (comment) =>
          comment.pageId === this.page.id &&
          comment.providerCommentId === providerCommentId &&
          comment.direction === "inbound"
      )
    ) {
      return []
    }
    const index = this.comments.length + 1
    const commentId = uuidFor(index + 200)
    const jobId = uuidFor(index + 300)
    const deliveryEnabled = values[29] === true
    const status: JobRecord["status"] =
      deliveryEnabled && this.page.webhookUrl ? "pending" : "failed_permanent"
    this.comments.push({
      id: commentId,
      pageId: this.page.id,
      providerCommentId,
      direction: "inbound",
      text: stringValue(values[8]),
    })
    this.jobs.push({
      id: jobId,
      eventId: stringValue(values[10]),
      tenantId: this.page.tenantId,
      messageId: null,
      commentId,
      connectionId: this.page.id,
      channel: this.page.channel,
      providerPageId: this.page.providerPageId,
      username: this.page.username,
      webhookUrl: this.page.webhookUrl,
      payload: { id: stringValue(values[10]), type: "comment.received" },
      status,
      attemptCount: 0,
      recoverAfter: dateValue(values[34]),
      signingSecretEncrypted: this.page.webhookSigningSecretEncrypted,
    })
    // Sin `usage`: Instagram está fuera de cuota.
    return [
      {
        comment_id: commentId,
        job_id: jobId,
        job_status: status,
        job_attempt_count: 0,
      },
    ]
  }
}

// El mismo orden que el `array_position` del repositorio: 'failed' y 'deleted'
// van por encima porque son terminales, y el estado ausente vale 0 para que el
// primer callback siempre entre.
const DELIVERY_STATUS_RANK = [
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "deleted",
]

function statusRank(value: string | undefined): number {
  return value ? DELIVERY_STATUS_RANK.indexOf(value) + 1 : 0
}

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
}

function pageRow(page: PageRecord): Row {
  return {
    id: page.id,
    tenant_id: page.tenantId,
    meta_page_id: page.providerPageId,
    channel: page.channel,
    name: page.name,
    username: page.username,
    status: page.status,
    token_status: page.tokenStatus,
    token_error: page.tokenError,
    webhook_url: page.webhookUrl,
    page_access_token_encrypted: page.pageAccessTokenEncrypted,
    webhook_signing_secret_encrypted: page.webhookSigningSecretEncrypted,
    // Columnas de la 0015. El `select` real todavía no las pide, así que
    // llegarían como undefined y `mapPage` las leería como null; informarlas
    // acá deja el fake describiendo la fila que la tabla sí tiene.
    waba_id: page.wabaId,
    whatsapp_phone_e164: page.phoneE164,
    onboarding_mode: page.onboardingMode,
    coexistence_status: page.coexistenceStatus,
    history_sync_status: page.historySyncStatus,
    token_expires_at: page.tokenExpiresAt,
    connected_at: page.connectedAt,
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
