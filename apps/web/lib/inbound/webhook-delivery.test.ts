import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock, transactionMock, sendMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  transactionMock: vi.fn(),
  sendMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getSql: () => Object.assign(sqlMock, { transaction: transactionMock }),
}))

// El cliente real haría flush a través del `fetch` mockeado y el test fallaría.
vi.mock("@/lib/posthog", () => ({ posthog: null }))

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { WEBHOOK_DELIVERIES: { send: sendMock } } }),
}))

import {
  classifyDeliveryResponse,
  consumeWebhookQueue,
  deliverJob,
  enqueueDelivery,
  eventIdFor,
  retryDelaySeconds,
} from "./webhook-delivery"

const payload = {
  type: "message" as const,
  tenant: { id: "tenant-1" },
  page: {
    id: "page-row",
    channel: "messenger" as const,
    metaPageId: "meta-page",
    name: "Main Page",
    username: null,
  },
  conversation: { id: "conversation-1", contactId: "psid-1" },
  message: {
    id: "message-1",
    metaMessageId: "mid-1",
    eventType: "message" as const,
    postbackPayload: null,
    direction: "inbound" as const,
    status: "received" as const,
    text: "hola",
    attachment: null,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
}

const jobRow = {
  id: "job-1",
  event_id: "evt_message1",
  tenant_id: "tenant-1",
  message_id: "message-1",
  instagram_comment_id: null,
  webhook_url: "https://example.com/hook",
  payload,
  status: "processing",
  attempt_count: 1,
  recover_after: "2026-01-02T00:02:00.000Z",
  connected_page_id: "page-row",
  channel: "messenger",
  meta_page_id: "meta-page",
  username: null,
}

function queueMessage(body: unknown) {
  return {
    id: "queue-msg-1",
    timestamp: new Date("2026-01-02T00:00:00.000Z"),
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

beforeEach(() => {
  sqlMock.mockReset()
  transactionMock.mockReset()
  sendMock.mockReset()
  sqlMock.mockResolvedValue([])
  transactionMock.mockResolvedValue([])
  vi.unstubAllGlobals()
})

describe("eventIdFor", () => {
  // Determinista y derivado del uuid: el mismo evento reingerido produce el
  // mismo id, que es de lo que se agarra el consumidor para deduplicar.
  it("deriva un id estable del uuid del sujeto", () => {
    const subject = { kind: "message" as const, id: "0189a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b" }
    expect(eventIdFor(subject)).toBe("evt_0189a1b2c3d44e5f8a9b0c1d2e3f4a5b")
    expect(eventIdFor(subject)).toBe(eventIdFor(subject))
  })

  it("distingue un comentario de un mensaje con el mismo uuid", () => {
    // No hace falta prefijo por tipo: los uuid vienen de tablas distintas y no
    // colisionan. Lo que importa es que el id salga del sujeto y no del reloj.
    expect(eventIdFor({ kind: "comment", id: "abc-def" })).toBe("evt_abcdef")
  })
})

describe("classifyDeliveryResponse", () => {
  it("trata 2xx como éxito", () => {
    expect(classifyDeliveryResponse(200).kind).toBe("success")
    expect(classifyDeliveryResponse(204).kind).toBe("success")
  })

  // La política que ya tenía `attemptPush`, conservada al pie de la letra: un
  // 404 del endpoint del tenant no mejora reintentándolo.
  it("reintenta solo ante 408, 429 y 5xx", () => {
    expect(classifyDeliveryResponse(408).kind).toBe("retry")
    expect(classifyDeliveryResponse(429).kind).toBe("retry")
    expect(classifyDeliveryResponse(503).kind).toBe("retry")
    expect(classifyDeliveryResponse(400).kind).toBe("permanent")
    expect(classifyDeliveryResponse(404).kind).toBe("permanent")
    expect(classifyDeliveryResponse(401).kind).toBe("permanent")
  })
})

describe("retryDelaySeconds", () => {
  // El cambio que justifica todo el paso: antes eran 3 intentos en ~4 segundos.
  it("escala hasta 15 minutos y se queda ahí", () => {
    expect(retryDelaySeconds(1)).toBe(5)
    expect(retryDelaySeconds(2)).toBe(30)
    expect(retryDelaySeconds(5)).toBe(900)
    expect(retryDelaySeconds(99)).toBe(900)
  })

  it("no se rompe con un contador en cero o negativo", () => {
    expect(retryDelaySeconds(0)).toBe(5)
    expect(retryDelaySeconds(-3)).toBe(5)
  })
})

describe("enqueueDelivery", () => {
  it("registra la entrega fallida sin encolar ni salir a la red con una URL insegura", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await enqueueDelivery({
      subject: { kind: "message", id: "message-1" },
      webhookUrl: "http://example.com/hook",
      payload,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(sqlMock.mock.calls[0]?.slice(1)).toEqual([
      "message-1",
      null,
      "http://example.com/hook",
      "failed",
      null,
      "La URL tiene que usar https. Solo se permite http en localhost, para desarrollo.",
      1,
    ])
  })

  it("escribe el job y encola solo su id", async () => {
    sqlMock.mockResolvedValueOnce([{ id: "job-1" }])

    await enqueueDelivery({
      subject: { kind: "message", id: "message-1" },
      webhookUrl: "https://example.com/hook",
      payload,
    })

    // El payload va como jsonb en la fila, no dentro del mensaje de la cola: el
    // reintento tiene que leer el estado actual del job, no una copia congelada.
    expect(sendMock).toHaveBeenCalledWith({ jobId: "job-1" })
    const params = sqlMock.mock.calls[0]?.slice(1)
    expect(params?.[0]).toBe("evt_message1")
    expect(JSON.parse(String(params?.[5]))).toEqual(payload)
  })

  it("no reencola un job que ya se intentó entregar", async () => {
    // Meta reintentando un evento que ya procesamos. Sin esta guarda el tenant
    // recibiría el mismo mensaje dos veces.
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "job-1", status: "succeeded", attempt_count: 1 }])

    await enqueueDelivery({
      subject: { kind: "message", id: "message-1" },
      webhookUrl: "https://example.com/hook",
      payload,
    })

    expect(sendMock).not.toHaveBeenCalled()
  })

  it("reencola un job que quedó pendiente sin ningún intento", async () => {
    // El Worker murió entre el insert y el `send`. El cron lo recuperaría igual,
    // pero cinco minutos después.
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "job-1", status: "pending", attempt_count: 0 }])

    await enqueueDelivery({
      subject: { kind: "message", id: "message-1" },
      webhookUrl: "https://example.com/hook",
      payload,
    })

    expect(sendMock).toHaveBeenCalledWith({ jobId: "job-1" })
  })
})

describe("deliverJob", () => {
  it("entrega y cierra el job cuando el tenant responde 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    sqlMock
      .mockResolvedValueOnce([{ id: "job-1" }]) // claim
      .mockResolvedValueOnce([jobRow]) // getJob

    const result = await deliverJob({ jobId: "job-1", fetcher: fetchMock })

    expect(result).toEqual({ disposition: "ack" })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.com/hook")
    expect(transactionMock).toHaveBeenCalledOnce()
  })

  it("pide reintento con el retardo del intento actual ante un 503", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    sqlMock
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([{ ...jobRow, attempt_count: 2 }])

    const result = await deliverJob({ jobId: "job-1", fetcher: fetchMock })

    expect(result).toEqual({ disposition: "retry", delaySeconds: 30 })
  })

  it("no reintenta un 404 del endpoint del tenant", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    sqlMock
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([jobRow])

    const result = await deliverJob({ jobId: "job-1", fetcher: fetchMock })

    expect(result).toEqual({ disposition: "ack" })
  })

  it("reintenta ante un fallo de red", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"))
    sqlMock
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([jobRow])

    const result = await deliverJob({ jobId: "job-1", fetcher: fetchMock })

    expect(result.disposition).toBe("retry")
  })

  it("acepta sin entregar un job que ya está cerrado", async () => {
    // La doble entrega es el modo de falla más caro de una cola: el claim no
    // encuentra fila y el job ya está `succeeded`.
    const fetchMock = vi.fn()
    sqlMock
      .mockResolvedValueOnce([]) // claim no agarra
      .mockResolvedValueOnce([{ ...jobRow, status: "succeeded" }])

    const result = await deliverJob({ jobId: "job-1", fetcher: fetchMock })

    expect(result).toEqual({ disposition: "ack" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("reintenta cuando otra invocación tiene el job reclamado", async () => {
    const fetchMock = vi.fn()
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...jobRow, status: "processing", attempt_count: 1 }])

    const result = await deliverJob({ jobId: "job-1", fetcher: fetchMock })

    expect(result).toEqual({ disposition: "retry", delaySeconds: 5 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("consumeWebhookQueue", () => {
  it("acepta y no reintenta un cuerpo sin jobId", async () => {
    // No va a parsear mejor en el siguiente intento. Lo accionable es el log.
    const message = queueMessage({ nope: true })

    await consumeWebhookQueue({
      queue: "webhook-deliveries",
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    })

    expect(message.ack).toHaveBeenCalledOnce()
    expect(message.retry).not.toHaveBeenCalled()
  })

  it("en la DLQ marca el job dead y nunca llama al webhook del cliente", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    sqlMock.mockResolvedValueOnce([{ id: "job-1" }])
    const message = queueMessage({ jobId: "job-1" })

    await consumeWebhookQueue({
      queue: "webhook-deliveries-dlq",
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(message.ack).toHaveBeenCalledOnce()
  })

  it("devuelve el mensaje a la DLQ si no pudo persistir el estado terminal", async () => {
    // Persistir el estado terminal **es** el traspaso: si la base falla, el
    // mensaje tiene que seguir disponible, no darse por procesado.
    sqlMock.mockRejectedValueOnce(new Error("db down"))
    const message = queueMessage({ jobId: "job-1" })

    await consumeWebhookQueue({
      queue: "webhook-deliveries-dlq",
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    })

    expect(message.ack).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 5 })
  })
})
