import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ConnectedPageRecord } from "@/lib/pages/page-registry"

const mocks = vi.hoisted(() => ({
  applyWhatsappTemplateUpdate: vi.fn(),
  listConnections: vi.fn(),
  findConnectionId: vi.fn(),
  resolveWhatsappAccess: vi.fn(),
  getTenantEntitlement: vi.fn(),
  enqueueDelivery: vi.fn(),
  recordSkippedDelivery: vi.fn(),
  queueSend: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/whatsapp-templates/template-store", () => ({
  applyWhatsappTemplateUpdate: mocks.applyWhatsappTemplateUpdate,
}))

vi.mock("@/lib/pages/page-registry", () => ({
  listActiveWhatsappWebhookConnectionsInWaba: mocks.listConnections,
  findActiveWhatsappConnectionIdInWaba: mocks.findConnectionId,
}))

vi.mock("@/lib/auth/channel-access", () => ({
  resolveWhatsappAccess: mocks.resolveWhatsappAccess,
}))

vi.mock("@/lib/billing/entitlement-status", () => ({
  getTenantEntitlement: mocks.getTenantEntitlement,
}))

vi.mock("./webhook-delivery", () => ({
  enqueueDelivery: mocks.enqueueDelivery,
}))

// El builder del payload se deja real: es parte de lo que se prueba.
vi.mock("./external-push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./external-push")>()),
  recordSkippedDelivery: mocks.recordSkippedDelivery,
}))

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { WHATSAPP_JOBS: { send: mocks.queueSend } },
  }),
}))

vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  log: mocks.log,
}))

const { ingestWhatsappTemplateEvents } = await import(
  "./whatsapp-template-ingestion"
)

const WABA = "waba-1"

const connection = (
  id: string,
  overrides: Partial<ConnectedPageRecord> = {}
): ConnectedPageRecord => ({
  id,
  tenantId: `tenant-${id}`,
  clientAccountId: null,
  channel: "whatsapp",
  metaPageId: `phone-${id}`,
  name: `Número ${id}`,
  username: null,
  status: "active",
  tokenStatus: "valid",
  tokenError: null,
  tokenErrorAt: null,
  tokenExpiresAt: null,
  webhookUrl: `https://bot.example/${id}`,
  pausedAt: null,
  wabaId: WABA,
  whatsappPhoneE164: null,
  onboardingMode: "standard",
  coexistenceStatus: null,
  historySyncStatus: null,
  whatsappPinGenerated: false,
  hasSigningSecret: true,
  connectedAt: new Date("2026-01-01"),
  disconnectedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
})

const statusEvent = (overrides: Record<string, unknown> = {}) => ({
  wabaId: WABA,
  metaTemplateId: "hsm-1",
  name: "bienvenida",
  language: "es",
  timestamp: new Date("2026-09-01"),
  event: "APPROVED",
  status: "APPROVED",
  needsResync: false,
  category: "utility" as const,
  reason: null,
  ...overrides,
})

const changed = {
  kind: "status_changed",
  templateId: "tpl-1",
  event: {
    id: "ev-1",
    templateId: "tpl-1",
    wabaId: WABA,
    name: "bienvenida",
    language: "es",
    status: "APPROVED",
    previousStatus: "PENDING",
    category: "utility",
    reason: null,
  },
}

const ingest = (input: Partial<Parameters<typeof ingestWhatsappTemplateEvents>[0]>) =>
  ingestWhatsappTemplateEvents({
    statuses: [],
    categories: [],
    quality: [],
    requestId: "req-1",
    ...input,
  })

// Los `pushJob` son lo que la ruta corre en `after()`.
const runAll = async (deliveries: Array<{ pushJob: () => Promise<void> }>) => {
  for (const delivery of deliveries) await delivery.pushJob()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.applyWhatsappTemplateUpdate.mockResolvedValue(changed)
  mocks.listConnections.mockResolvedValue([connection("a")])
  mocks.resolveWhatsappAccess.mockResolvedValue(true)
  mocks.getTenantEntitlement.mockResolvedValue({ block: null })
  mocks.enqueueDelivery.mockResolvedValue(undefined)
  mocks.recordSkippedDelivery.mockResolvedValue(undefined)
})

describe("ingestWhatsappTemplateEvents — estado", () => {
  it("aplica el estado a la copia y encola el evento firmado a la conexión", async () => {
    const deliveries = await ingest({ statuses: [statusEvent()] })

    expect(mocks.applyWhatsappTemplateUpdate).toHaveBeenCalledWith({
      wabaId: WABA,
      metaTemplateId: "hsm-1",
      name: "bienvenida",
      language: "es",
      status: "APPROVED",
      category: "utility",
      reason: null,
    })
    expect(mocks.listConnections).toHaveBeenCalledWith(WABA)
    // Nada sale antes del `after()`.
    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()

    await runAll(deliveries)

    expect(mocks.enqueueDelivery).toHaveBeenCalledWith({
      subject: { kind: "template", id: "ev-1", connectionId: "a" },
      webhookUrl: "https://bot.example/a",
      payload: {
        type: "template",
        tenant: { id: "tenant-a" },
        page: {
          id: "a",
          channel: "whatsapp",
          metaPageId: "phone-a",
          name: "Número a",
          username: null,
          phoneNumberId: "phone-a",
          wabaId: WABA,
          onboardingMode: "standard",
        },
        template: {
          name: "bienvenida",
          language: "es",
          status: "APPROVED",
          category: "utility",
          reason: null,
        },
      },
      context: expect.objectContaining({
        subject: "template",
        subjectId: "ev-1",
        connectionId: "a",
      }),
    })
  })

  it("reparte a las N conexiones de la WABA, de cualquier tenant", async () => {
    mocks.listConnections.mockResolvedValue([
      connection("a"),
      connection("b"),
      connection("c", { tenantId: "tenant-a" }),
    ])

    await runAll(await ingest({ statuses: [statusEvent()] }))

    expect(mocks.enqueueDelivery).toHaveBeenCalledTimes(3)
    expect(
      mocks.enqueueDelivery.mock.calls.map(([input]) => [
        input.subject.connectionId,
        input.payload.tenant.id,
      ])
    ).toEqual([
      ["a", "tenant-a"],
      ["b", "tenant-b"],
      ["c", "tenant-a"],
    ])
    // Memo por lote: el tenant repetido se resuelve una sola vez.
    expect(mocks.getTenantEntitlement).toHaveBeenCalledTimes(2)
  })

  it("una conexión pausada queda skipped y las demás se entregan", async () => {
    mocks.listConnections.mockResolvedValue([
      connection("a", { pausedAt: new Date("2026-08-01") }),
      connection("b"),
    ])

    await runAll(await ingest({ statuses: [statusEvent()] }))

    expect(mocks.recordSkippedDelivery).toHaveBeenCalledWith(
      { kind: "template", id: "ev-1", connectionId: "a" },
      expect.objectContaining({
        logReason: "connection_paused",
        payload: expect.objectContaining({ type: "template" }),
      })
    )
    expect(mocks.enqueueDelivery).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueDelivery.mock.calls[0]?.[0].subject.connectionId).toBe(
      "b"
    )
  })

  it("una cuenta restringida queda skipped", async () => {
    mocks.getTenantEntitlement.mockResolvedValue({
      block: { code: "quota_exceeded", status: 402, message: "sin cuota" },
    })

    await runAll(await ingest({ statuses: [statusEvent()] }))

    expect(mocks.enqueueDelivery).not.toHaveBeenCalled()
    expect(mocks.recordSkippedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "template" }),
      expect.objectContaining({ logReason: "account_restricted" })
    )
  })

  it("un tenant sin el canal de WhatsApp no recibe nada", async () => {
    mocks.resolveWhatsappAccess.mockResolvedValue(false)

    const deliveries = await ingest({ statuses: [statusEvent()] })

    expect(deliveries).toEqual([])
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "channel_not_enabled" })
    )
  })

  it("el mismo estado repetido no genera un evento nuevo", async () => {
    mocks.applyWhatsappTemplateUpdate.mockResolvedValue({
      kind: "unchanged",
      templateId: "tpl-1",
    })

    const deliveries = await ingest({ statuses: [statusEvent()] })

    expect(deliveries).toEqual([])
    expect(mocks.listConnections).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_status_update",
        outcome: "duplicate",
      })
    )
  })

  it("un evento que no es un estado no toca la copia", async () => {
    const deliveries = await ingest({
      statuses: [statusEvent({ event: "FLAGGED", status: null })],
    })

    expect(deliveries).toEqual([])
    expect(mocks.applyWhatsappTemplateUpdate).not.toHaveBeenCalled()
    expect(mocks.queueSend).not.toHaveBeenCalled()
  })

  it("UNARCHIVED vuelve a sincronizar la WABA", async () => {
    mocks.findConnectionId.mockResolvedValue("a")

    await ingest({
      statuses: [
        statusEvent({ event: "UNARCHIVED", status: null, needsResync: true }),
      ],
    })

    expect(mocks.applyWhatsappTemplateUpdate).not.toHaveBeenCalled()
    expect(mocks.queueSend).toHaveBeenCalledWith({
      type: "template_sync",
      connectionId: "a",
    })
  })

  it("una plantilla que falla no se lleva al resto del lote", async () => {
    mocks.applyWhatsappTemplateUpdate
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(changed)

    const deliveries = await ingest({
      statuses: [statusEvent({ name: "rota" }), statusEvent()],
    })

    expect(deliveries).toHaveLength(1)
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_status_update",
        outcome: "failed",
        templateName: "rota",
      })
    )
  })
})

describe("ingestWhatsappTemplateEvents — categoría y calidad", () => {
  const ref = {
    wabaId: WABA,
    metaTemplateId: "hsm-1",
    name: "bienvenida",
    language: "es",
    timestamp: new Date("2026-09-01"),
  }

  it("la recategorización solo actualiza la copia, sin evento", async () => {
    mocks.applyWhatsappTemplateUpdate.mockResolvedValue({
      kind: "unchanged",
      templateId: "tpl-1",
    })

    const deliveries = await ingest({
      categories: [
        {
          ...ref,
          category: "marketing",
          previousCategory: "UTILITY",
          upcomingCategory: null,
        },
      ],
    })

    expect(deliveries).toEqual([])
    expect(mocks.applyWhatsappTemplateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: null, category: "marketing" })
    )
  })

  it("la calidad solo va a logs", async () => {
    const deliveries = await ingest({
      quality: [{ ...ref, previousQuality: "GREEN", newQuality: "RED" }],
    })

    expect(deliveries).toEqual([])
    expect(mocks.applyWhatsappTemplateUpdate).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_quality_update",
        level: "warn",
        templateQuality: "RED",
        previousTemplateQuality: "GREEN",
      })
    )
  })
})
