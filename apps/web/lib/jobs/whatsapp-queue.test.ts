import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  syncWhatsappTemplateCatalog: vi.fn(),
  requestHistorySync: vi.fn(),
  markHistorySyncFailed: vi.fn(),
  downloadMediaToR2: vi.fn(),
  markAttachmentFailed: vi.fn(),
  handleMediaPurgeJob: vi.fn(),
  getMediaBucket: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/whatsapp-templates/template-sync", () => ({
  syncWhatsappTemplateCatalog: mocks.syncWhatsappTemplateCatalog,
}))
vi.mock("./history-sync", () => ({
  requestHistorySync: mocks.requestHistorySync,
  markHistorySyncFailed: mocks.markHistorySyncFailed,
}))
vi.mock("./media-download", () => ({
  downloadMediaToR2: mocks.downloadMediaToR2,
  markAttachmentFailed: mocks.markAttachmentFailed,
}))
vi.mock("@/lib/account/media-purge", () => ({
  handleMediaPurgeJob: mocks.handleMediaPurgeJob,
}))
vi.mock("@/lib/messages/media-access", () => ({
  getMediaBucket: mocks.getMediaBucket,
}))
vi.mock("@/lib/observability/logger", () => ({ log: mocks.log }))

import { consumeWhatsappQueue } from "./whatsapp-queue"

// El consumidor de `whatsapp-jobs`, visto desde afuera: qué trabajo se hace por
// cada cuerpo y qué le pasa al mensaje de la cola. Los jobs van mockeados
// —cada uno tiene su propio test— porque lo que se fija acá es el despacho.

function queueMessage(body: unknown) {
  return {
    id: "msg-1",
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function batch(body: unknown, options: { queue?: string } = {}) {
  const message = queueMessage(body)
  return {
    message,
    batch: {
      queue: options.queue ?? "whatsapp-jobs",
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<unknown>,
  }
}

const env = {} as CloudflareEnv

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe("consumo de whatsapp-jobs", () => {
  it("manda un template_sync al sync del catálogo, con el id de la conexión", async () => {
    const { batch: b, message } = batch({
      type: "template_sync",
      connectionId: "conn-1",
    })

    await consumeWhatsappQueue(b, env)

    expect(mocks.syncWhatsappTemplateCatalog).toHaveBeenCalledWith({
      connectionId: "conn-1",
    })
    expect(message.ack).toHaveBeenCalled()
    expect(message.retry).not.toHaveBeenCalled()
  })

  // El job no lanza cuando falla Graph: devuelve el motivo. Un `ok: false` no
  // puede convertirse en un reintento de la cola, que repetiría la misma
  // llamada contra el mismo token vencido cinco veces.
  it("acepta el mensaje aunque el sync no haya podido importar nada", async () => {
    mocks.syncWhatsappTemplateCatalog.mockResolvedValue({
      ok: false,
      reason: "graph_failed",
    })
    const { batch: b, message } = batch({
      type: "template_sync",
      connectionId: "conn-1",
    })

    await consumeWhatsappQueue(b, env)

    expect(message.ack).toHaveBeenCalled()
    expect(message.retry).not.toHaveBeenCalled()
  })

  // Lo que sí se reintenta: el fallo de la base que sube desde el job. La
  // importación es idempotente, así que repetirla entera no cuesta filas.
  it("reintenta cuando el sync lanza", async () => {
    mocks.syncWhatsappTemplateCatalog.mockRejectedValue(new Error("db down"))
    const { batch: b, message } = batch({
      type: "template_sync",
      connectionId: "conn-1",
    })

    await consumeWhatsappQueue(b, env)

    expect(message.retry).toHaveBeenCalled()
    expect(message.ack).not.toHaveBeenCalled()
  })

  it("sigue despachando los tipos que ya existían", async () => {
    const { batch: b } = batch({
      type: "history_sync_request",
      connectionId: "conn-9",
    })

    await consumeWhatsappQueue(b, env)

    expect(mocks.requestHistorySync).toHaveBeenCalledWith({
      connectionId: "conn-9",
    })
    expect(mocks.syncWhatsappTemplateCatalog).not.toHaveBeenCalled()
  })

  // Un `type` que no está en la unión no es un job: reintentarlo es repetir el
  // mismo fallo cinco veces para terminar igual en la DLQ.
  it("descarta un cuerpo con un type desconocido sin reintentarlo", async () => {
    const { batch: b, message } = batch({ type: "template_purge" })

    await consumeWhatsappQueue(b, env)

    expect(mocks.syncWhatsappTemplateCatalog).not.toHaveBeenCalled()
    expect(message.ack).toHaveBeenCalled()
    expect(message.retry).not.toHaveBeenCalled()
  })
})

describe("consumo de la DLQ", () => {
  // El sync de plantillas no tiene estado derivado que corregir: el espejo no
  // lleva columna de import y un catálogo que no llegó es indistinguible de una
  // WABA vacía. La constancia del log es todo lo que este caso admite, y por
  // eso **no** se rehace el trabajo.
  it("no vuelve a intentar el sync de plantillas ni marca nada", async () => {
    const { batch: b, message } = batch(
      { type: "template_sync", connectionId: "conn-1" },
      { queue: "whatsapp-jobs-dlq" }
    )

    await consumeWhatsappQueue(b, env)

    expect(mocks.syncWhatsappTemplateCatalog).not.toHaveBeenCalled()
    expect(mocks.markHistorySyncFailed).not.toHaveBeenCalled()
    expect(mocks.markAttachmentFailed).not.toHaveBeenCalled()
    expect(message.ack).toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "dropped",
        reason: "queue_retries_exhausted",
      })
    )
  })

  it("sí marca el historial como fallido, que es el que tiene estado", async () => {
    const { batch: b } = batch(
      { type: "history_sync_request", connectionId: "conn-1" },
      { queue: "whatsapp-jobs-dlq" }
    )

    await consumeWhatsappQueue(b, env)

    expect(mocks.markHistorySyncFailed).toHaveBeenCalledWith("conn-1")
  })
})
