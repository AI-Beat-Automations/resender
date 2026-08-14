import { describe, expect, it } from "vitest"

import type {
  WhatsappContactSyncEvent,
  WhatsappMessageEvent,
  WhatsappStatusEvent,
} from "../../domain/whatsapp-events"
import type { Sql } from "./client"
import {
  SqlRepository,
  messageDto,
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

describe("ingesta de WhatsApp", () => {
  it("un entrante en vivo abre la ventana de atención de 24 h", async () => {
    const sql = capturingSql([[whatsappIngestRow()]])
    const repository = new SqlRepository(sql.client)

    await repository.ingestWhatsappInbound(whatsappIngestInput())

    const call = taggedCall(sql, 0)
    expect(bindAfter(call, "-- ventana de 24 h")).toEqual(WHATSAPP_CREATED_AT)
    expect(call.statement).toContain("last_inbound_at = greatest")
  })

  it("un mensaje importado del historial no la abre", async () => {
    const sql = capturingSql([[whatsappIngestRow(withoutJob())]])
    const repository = new SqlRepository(sql.client)

    await repository.ingestWhatsappInbound(
      whatsappIngestInput({ event: whatsappHistoryEvent() })
    )

    // Null y no una fecha vieja: la conversación conserva la ventana que
    // tuviera, porque greatest ignora los nulls.
    expect(bindAfter(taggedCall(sql, 0), "-- ventana de 24 h")).toBeNull()
  })

  // Un `user_changed_number` llega como entrante y en vivo, pero no lo escribió
  // nadie: lo genera WhatsApp. Abrir con él 24 h de mensajería libre es
  // prometer una ventana que Meta no reconoce, y el primer envío vuelve con un
  // 131047.
  it("un evento de sistema entrante tampoco abre la ventana, y uno del cliente sí", async () => {
    const system = capturingSql([[whatsappIngestRow()]])
    await new SqlRepository(system.client).ingestWhatsappInbound(
      whatsappIngestInput({ event: whatsappSystemEvent() })
    )
    expect(bindAfter(taggedCall(system, 0), "-- ventana de 24 h")).toBeNull()

    // El contraste, con el mismo tipo de mensaje y solo el origen cambiado:
    // lo que decide es quién escribió, no la dirección ni la frescura.
    const customer = capturingSql([[whatsappIngestRow()]])
    await new SqlRepository(customer.client).ingestWhatsappInbound(
      whatsappIngestInput({
        event: whatsappSystemEvent({ origin: "customer" }),
      })
    )
    expect(bindAfter(taggedCall(customer, 0), "-- ventana de 24 h")).toEqual(
      WHATSAPP_CREATED_AT
    )
  })

  it("no reenvía el historial al webhook externo y sí el echo", async () => {
    const history = capturingSql([[whatsappIngestRow(withoutJob())]])
    const historyResult = await new SqlRepository(
      history.client
    ).ingestWhatsappInbound(
      whatsappIngestInput({ event: whatsappHistoryEvent() })
    )

    // El bind que gobierna la entrega es `historical`, y el SQL la apaga con
    // `where not ?`: sin job no hay fila que encolar ni que fallar.
    expect(bindAfter(taggedCall(history, 0), "-- entrega externa")).toBe(true)
    expect(taggedCall(history, 0).statement).toContain("where not ?")
    expect(historyResult).toMatchObject({
      inserted: true,
      jobId: null,
      jobStatus: null,
    })

    const echo = capturingSql([[whatsappIngestRow()]])
    const echoResult = await new SqlRepository(
      echo.client
    ).ingestWhatsappInbound(whatsappIngestInput({ event: whatsappEchoEvent() }))

    expect(bindAfter(taggedCall(echo, 0), "-- entrega externa")).toBe(false)
    expect(echoResult.jobId).toBe(WHATSAPP_JOB_ID)
    // Estrechar por `jobId` tiene que dejar el resultado utilizable tal cual
    // por `enqueueIfPending`: si esto deja de compilar, el servicio ya no puede
    // encolar sin adaptar la forma.
    if (echoResult.jobId !== null) {
      expect(enqueueableJobId(echoResult)).toBe(WHATSAPP_JOB_ID)
    }
  })

  it("registra cada adjunto con su job de descarga y sin pedirle nada a Meta", async () => {
    const sql = capturingSql([[whatsappIngestRow()]])
    const repository = new SqlRepository(sql.client)

    await repository.ingestWhatsappInbound(
      whatsappIngestInput({
        event: whatsappEvent({
          type: "document",
          text: "Factura",
          attachments: [
            {
              kind: "document",
              providerMediaId: "media-1",
              mimeType: "application/pdf",
              sha256: "checksum-1",
              filename: "factura.pdf",
              caption: "Factura",
              voice: null,
              animated: null,
            },
            {
              kind: "sticker",
              providerMediaId: "media-2",
              mimeType: null,
              sha256: null,
              filename: null,
              caption: null,
              voice: null,
              animated: true,
            },
          ],
        }),
      })
    )

    const call = taggedCall(sql, 0)
    expect(call.statement).toContain("insert into message_attachments")
    expect(call.statement).toContain("insert into whatsapp_media_jobs")
    expect(call.statement).toContain("on conflict (attachment_id) do nothing")
    // Ni una URL de Meta ni una descarga: solo lo que venía en el webhook.
    expect(
      JSON.parse(String(bindAfter(call, "cross join jsonb_to_recordset(")))
    ).toEqual([
      {
        kind: "document",
        provider_media_id: "media-1",
        mime_type: "application/pdf",
        filename: "factura.pdf",
        caption: "Factura",
        sha256: "checksum-1",
      },
      {
        kind: "sticker",
        provider_media_id: "media-2",
        // Meta no siempre manda mime_type y la columna es not null.
        mime_type: "application/octet-stream",
        filename: null,
        caption: null,
        sha256: null,
      },
    ])
  })

  it("deduplica el reenvío de un entrante sin crear un segundo mensaje", async () => {
    const sql = capturingSql([[], [whatsappDuplicateRow()]])
    const repository = new SqlRepository(sql.client)

    await expect(
      repository.ingestWhatsappInbound(whatsappIngestInput())
    ).resolves.toEqual({
      inserted: false,
      messageId: WHATSAPP_MESSAGE_ID,
      jobId: WHATSAPP_JOB_ID,
      jobStatus: "pending",
      jobAttemptCount: 2,
      jobRecoverAfter: new Date("2026-08-13T18:02:00.000Z"),
    })
    expect(taggedCall(sql, 1).values).toContain("inbound")
  })

  it("deduplica un echo repetido, que vive en el otro índice parcial", async () => {
    const sql = capturingSql([[], [whatsappDuplicateRow()]])
    const repository = new SqlRepository(sql.client)

    await expect(
      repository.ingestWhatsappInbound(
        whatsappIngestInput({ event: whatsappEchoEvent() })
      )
    ).resolves.toMatchObject({
      inserted: false,
      messageId: WHATSAPP_MESSAGE_ID,
    })
    // El insert no nombra ningún índice: los predicados de los dos uniques
    // parciales dependen de la fila, y solo sin target aciertan los dos.
    expect(taggedCall(sql, 0).statement).toContain("on conflict do nothing")
    expect(taggedCall(sql, 1).values).toContain("outbound")
  })

  // Los dos uniques parciales no cubren `origin = 'resender_api'`, así que un
  // envío nuestro y su echo de Coexistence pueden acabar en dos filas salientes
  // con el mismo wamid. Un `limit 1` sin `order by` devolvería cualquiera de las
  // dos, y con la equivocada el servicio reporta un messageId que no es y se
  // salta el encolado.
  it("la relectura del dedupe pide la fila del evento que se está ingiriendo", async () => {
    const sql = capturingSql([[], [whatsappDuplicateRow()]])

    await new SqlRepository(sql.client).ingestWhatsappInbound(
      whatsappIngestInput({ event: whatsappEchoEvent() })
    )

    const call = taggedCall(sql, 1)
    expect(call.statement).toContain("order by")
    // El criterio es el origen del propio evento, y por eso viaja como bind.
    expect(
      bindAfter(call, "order by (m.origin is not distinct from")
    ).toBe("business_app")
  })
})

describe("estados de entrega de WhatsApp", () => {
  it("avanza al estado posterior y no retrocede con un callback atrasado", async () => {
    const harness = deliveryStatusSql("sent")
    const repository = new SqlRepository(harness.client)

    await expect(
      repository.applyWhatsappStatus(whatsappStatusInput("read"))
    ).resolves.toEqual({
      updated: true,
      messageId: WHATSAPP_MESSAGE_ID,
      deliveryStatus: "read",
    })
    await expect(
      repository.applyWhatsappStatus(whatsappStatusInput("delivered"))
    ).resolves.toEqual({
      updated: false,
      messageId: WHATSAPP_MESSAGE_ID,
      deliveryStatus: "read",
    })
  })

  it("un fallo no lo pisa el delivered que venía en vuelo", async () => {
    const harness = deliveryStatusSql("failed")
    const repository = new SqlRepository(harness.client)

    await expect(
      repository.applyWhatsappStatus(whatsappStatusInput("delivered"))
    ).resolves.toMatchObject({ updated: false, deliveryStatus: "failed" })
  })

  it("guarda el error de Meta que viene con el status fallido", async () => {
    const sql = capturingSql([[]])
    const repository = new SqlRepository(sql.client)

    await repository.applyWhatsappStatus(
      whatsappStatusInput("failed", [
        {
          code: 131047,
          title: "Re-engagement message",
          message: null,
          details: "More than 24 hours have passed",
        },
      ])
    )

    expect(bindAfter(taggedCall(sql, 0), "-- El error solo se escribe")).toBe(
      "131047: Re-engagement message: More than 24 hours have passed"
    )
  })

  // El otro `limit 1` sin orden. Acá la fila que importa es la que el tenant ve
  // por la API —la que nació de su POST—, no el echo que Coexistence guardó del
  // mismo wamid: escribir el estado en el echo dejaría su mensaje congelado.
  it("elige la fila que el tenant envió por la API cuando hay dos con el mismo wamid", async () => {
    const sql = capturingSql([[]])

    await new SqlRepository(sql.client).applyWhatsappStatus(
      whatsappStatusInput("delivered")
    )

    expect(taggedCall(sql, 0).statement).toContain(
      "order by (origin is not distinct from 'resender_api') desc"
    )
  })

  it("un wamid que no es de un mensaje nuestro no actualiza nada ni falla", async () => {
    const repository = new SqlRepository(capturingSql([[]]).client)

    await expect(
      repository.applyWhatsappStatus(whatsappStatusInput("delivered"))
    ).resolves.toEqual({
      updated: false,
      messageId: null,
      deliveryStatus: null,
    })
  })
})

describe("sincronización de contactos de WhatsApp", () => {
  it("una edición, que Meta manda como add, reescribe el nombre", async () => {
    const sql = capturingSql([[{ id: "9e2327a8-0c42-493e-bd6c-c08ed81010f0" }]])
    const repository = new SqlRepository(sql.client)

    await expect(
      repository.applyWhatsappContactSync({
        page: whatsappPage(),
        event: whatsappContactEvent({ fullName: "Juana Pérez" }),
      })
    ).resolves.toEqual({ updated: true })

    const call = taggedCall(sql, 0)
    expect(call.statement).toContain("update conversations")
    // Un insert convertiría la agenda entera del negocio en hilos vacíos.
    expect(call.statement).not.toContain("insert into conversations")
    expect(call.values).toContain("Juana Pérez")
    // El teléfono se compara por dígitos: Meta manda unas veces con + y otras
    // sin él, para el mismo contacto.
    expect(call.values).toContain("5215555555555")
  })

  it("un remove olvida el nombre y no toca la conversación ni el historial", async () => {
    const sql = capturingSql([[]])
    const repository = new SqlRepository(sql.client)

    await expect(
      repository.applyWhatsappContactSync({
        page: whatsappPage(),
        event: whatsappContactEvent({ action: "remove", fullName: null }),
      })
    ).resolves.toEqual({ updated: false })

    const call = taggedCall(sql, 0)
    expect(bindAfter(call, "-- Un remove es")).toBe(true)
    expect(call.statement).not.toContain("delete from")
  })
})

describe("proyección de adjuntos", () => {
  it("lista los mensajes con sus adjuntos en una sola consulta", async () => {
    const sql = capturingSql([
      [
        messageRow({
          id: "11111111-1111-4111-8111-111111111111",
          message_type: "document",
          attachments: [attachmentJson()],
        }),
        messageRow({
          id: "22222222-2222-4222-8222-222222222222",
          attachments: [],
        }),
        messageRow({
          id: "33333333-3333-4333-8333-333333333333",
          message_type: "image",
          attachments: [attachmentJson({ kind: "image", status: "available" })],
        }),
      ],
    ])
    const repository = new SqlRepository(sql.client)

    const result = await repository.listMessages(
      "6b402566-9e1d-4739-bb61-81ac615a5469",
      { limit: 25 }
    )

    expect(sql.queries).toHaveLength(1)
    expect(sql.taggedStatements).toHaveLength(0)
    expect(sql.queries[0]?.text).toContain("left join lateral")
    expect(result.data[0]?.attachments).toEqual([
      {
        id: "44444444-4444-4444-8444-444444444444",
        kind: "document",
        mimeType: "application/pdf",
        filename: "factura.pdf",
        caption: null,
        sizeBytes: 12345,
        sha256: null,
        status: "pending",
        // El endpoint de descarga no existe todavía, y un adjunto pending
        // tampoco tiene bytes que ofrecer.
        downloadUrl: null,
      },
    ])
    expect(result.data[1]?.attachments).toEqual([])
    expect(result.data[2]?.type).toBe("image")
  })

  it("la lectura puntual de un mensaje proyecta los mismos adjuntos", async () => {
    const sql = capturingSql([
      [
        messageRow({
          message_type: "document",
          attachments: [attachmentJson()],
        }),
      ],
    ])
    const repository = new SqlRepository(sql.client)

    const message = await repository.getMessage(
      "6b402566-9e1d-4739-bb61-81ac615a5469",
      "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"
    )

    expect(sql.queries).toHaveLength(1)
    expect(message?.attachments).toHaveLength(1)
  })

  // La misma fila, pedida por las dos puertas que un cliente puede tocar: el
  // replay de `POST /v1/messages` con la Idempotency-Key repetida y el
  // `GET /v1/messages/{id}` del mismo id. Que devuelvan DTOs distintos es
  // justamente lo que la idempotencia promete que no pasa.
  //
  // La aserción fuerte es la del SQL, no la de los DTOs: el doble entrega la
  // misma fila pida lo que pida la sentencia, así que comparar objetos da verde
  // con la proyección recortada puesta. Comparar la proyección literal de las
  // dos consultas es lo que el fake no decide.
  it("el replay de idempotencia proyecta lo mismo que la lectura puntual", async () => {
    const row = messageRow({
      message_type: "image",
      content: { kind: "generic_event", eventType: "order", raw: null },
      origin: "resender_api",
      historical: false,
      delivery_status: "delivered",
      reply_to_meta_message_id: "wamid.anterior",
      attachments: [attachmentJson({ kind: "image" })],
    })
    const sql = capturingSql([[row], [row]])
    const repository = new SqlRepository(sql.client)

    const replayed = await repository.getOutboundByIdempotency(
      "6b402566-9e1d-4739-bb61-81ac615a5469",
      "order-1"
    )
    const fetched = await repository.getMessage(
      "6b402566-9e1d-4739-bb61-81ac615a5469",
      "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"
    )

    expect(sql.queries).toHaveLength(2)
    expect(projectionOf(sql.queries[0]!.text)).toBe(
      projectionOf(sql.queries[1]!.text)
    )
    expect(replayed).not.toBeNull()
    expect(fetched).not.toBeNull()
    expect(messageDto(replayed!)).toEqual(messageDto(fetched!))
    expect(messageDto(replayed!)).toMatchObject({
      type: "image",
      origin: "resender_api",
      deliveryStatus: "delivered",
      replyTo: { providerMessageId: "wamid.anterior" },
      attachments: [expect.objectContaining({ kind: "image" })],
    })
  })
})

// Lo que va antes del `where` de cada consulta: la lista de columnas y el join
// lateral de adjuntos. Se corta ahí porque el filtro sí difiere entre las dos
// lecturas —clave de idempotencia contra id— y lo que tiene que coincidir es la
// proyección.
function projectionOf(statement: string): string {
  const position = statement.indexOf("where messages.tenant_id")
  if (position < 0) throw new Error(`la consulta no filtra por tenant: ${statement}`)
  return statement.slice(0, position)
}

// El sobre que llega al webhook del tenant lleva `wabaId`, `phoneNumberId` y
// `onboardingMode`, y la consola pinta el bloque de WhatsApp con el estado de
// Coexistence. Todo eso sale de columnas que añadió la 0015, y en SQL una
// columna que no se pide no llega: `mapPage` la lee como null sin quejarse.
//
// **La aserción va contra el texto de la sentencia y no contra el `PageRecord`
// devuelto, y ese es el punto.** La fila que entrega un doble es tan generosa
// como quiera quien lo escribe —el fake de runtime informaba las cinco columnas
// aunque el `select` real no las pidiera—, así que un test que solo mire el
// objeto proyectado da verde con el bug puesto. El SQL es lo único que el fake
// no decide.
describe("proyección de la identidad de WhatsApp", () => {
  const MIGRATION_0015_COLUMNS = [
    "waba_id",
    "whatsapp_phone_e164",
    "onboarding_mode",
    "coexistence_status",
    "history_sync_status",
  ]

  it.each([
    [
      "getActivePageByProviderId",
      (repository: SqlRepository) =>
        repository.getActivePageByProviderId("phone-number-1", "whatsapp"),
    ],
    [
      "getPage",
      (repository: SqlRepository) =>
        repository.getPage(whatsappPage().tenantId, whatsappPage().id),
    ],
    [
      "listPages",
      (repository: SqlRepository) =>
        repository.listPages(whatsappPage().tenantId, { limit: 25 }),
    ],
    [
      "listAllPages",
      (repository: SqlRepository) =>
        repository.listAllPages(whatsappPage().tenantId),
    ],
    [
      "updatePageWebhook",
      (repository: SqlRepository) =>
        repository.updatePageWebhook(
          whatsappPage().tenantId,
          whatsappPage().id,
          null
        ),
    ],
    [
      "disconnectPage",
      (repository: SqlRepository) =>
        repository.disconnectPage(whatsappPage().tenantId, whatsappPage().id),
    ],
  ])("%s pide las cinco columnas de la 0015", async (_name, run) => {
    const sql = capturingSql([[whatsappPageRow()]])

    await run(new SqlRepository(sql.client))

    // Los dos transportes: las lecturas con filtros dinámicos van por `query` y
    // el resto por la plantilla etiquetada.
    const emitted = [
      ...sql.taggedStatements,
      ...sql.queries.map((query) => query.text),
    ].join("\n")
    for (const column of MIGRATION_0015_COLUMNS) {
      expect(emitted).toContain(column)
    }
  })

  // La otra mitad del contrato: pedidas las columnas, el mapeo tiene que
  // llevarlas hasta el `PageRecord`. Sin esta, cambiar el nombre de una columna
  // en el `select` pasaría el test de arriba y seguiría devolviendo nulls.
  it("lleva la identidad del canal desde la fila hasta el PageRecord", async () => {
    const sql = capturingSql([[whatsappPageRow()]])
    const repository = new SqlRepository(sql.client)

    await expect(
      repository.getActivePageByProviderId("phone-number-1", "whatsapp")
    ).resolves.toMatchObject({
      channel: "whatsapp",
      wabaId: "waba-1",
      phoneE164: "+5215550000000",
      onboardingMode: "coexistence",
      coexistenceStatus: "connected",
      historySyncStatus: "syncing",
    })
  })

  // Y el contraejemplo que documenta por qué el bug era invisible: una fila sin
  // esas llaves —exactamente lo que devolvía Postgres con el `select` viejo— no
  // rompe nada, solo apaga la identidad del canal en silencio.
  it("apaga la identidad, sin fallar, si la fila no trae las columnas", async () => {
    const { waba_id, whatsapp_phone_e164, onboarding_mode, ...incomplete } =
      whatsappPageRow()
    const sql = capturingSql([[incomplete]])
    const repository = new SqlRepository(sql.client)

    await expect(
      repository.getActivePageByProviderId("phone-number-1", "whatsapp")
    ).resolves.toMatchObject({
      channel: "whatsapp",
      wabaId: null,
      phoneE164: null,
      onboardingMode: null,
    })
  })
})

function whatsappPageRow(): Row {
  const page = whatsappPage()
  return {
    id: page.id,
    tenant_id: page.tenantId,
    channel: page.channel,
    meta_page_id: page.providerPageId,
    name: page.name,
    username: page.username,
    status: page.status,
    token_status: page.tokenStatus,
    token_error: page.tokenError,
    webhook_url: page.webhookUrl,
    page_access_token_encrypted: page.pageAccessTokenEncrypted,
    webhook_signing_secret_encrypted: page.webhookSigningSecretEncrypted,
    waba_id: page.wabaId,
    whatsapp_phone_e164: page.phoneE164,
    onboarding_mode: page.onboardingMode,
    coexistence_status: "connected",
    history_sync_status: "syncing",
    token_expires_at: page.tokenExpiresAt,
    connected_at: page.connectedAt,
    updated_at: page.updatedAt,
  }
}

const WHATSAPP_CREATED_AT = new Date("2026-08-13T18:00:00.000Z")
const WHATSAPP_MESSAGE_ID = "ef55c94e-b861-4d19-9f9b-b5689028de80"
const WHATSAPP_JOB_ID = "d743db7b-d4b8-4911-bf01-c639816856fc"

// La firma exacta que `enqueueIfPending` pide en el servicio. Existe para que
// el compilador, y no una revisión, sea quien vigile que el resultado de la
// ingesta se le puede pasar tal cual.
function enqueueableJobId(result: {
  inserted: boolean
  jobId: string
  jobStatus: string
  jobAttemptCount: number
}): string {
  return result.jobId
}

// Los binds del fake no tienen nombre: `capturingSql` une la sentencia con "?"
// en cada uno, así que el índice de un bind es cuántos "?" lo preceden. Los
// tests anclan en el comentario que va justo encima del bind que miran, y por
// eso no se rompen cuando cambia el resto de la sentencia.
function bindAfter(
  call: { statement: string; values: unknown[] },
  marker: string
): unknown {
  const position = call.statement.indexOf(marker)
  if (position < 0) throw new Error(`marcador ausente en el SQL: ${marker}`)
  return call.values[call.statement.slice(0, position).split("?").length - 1]
}

function taggedCall(
  sql: { taggedCalls: Array<{ statement: string; values: unknown[] }> },
  index: number
): { statement: string; values: unknown[] } {
  const call = sql.taggedCalls[index]
  if (!call) throw new Error(`no hubo sentencia número ${index}`)
  return call
}

function whatsappIngestInput(
  overrides: { event?: WhatsappMessageEvent } = {}
): Parameters<SqlRepository["ingestWhatsappInbound"]>[0] {
  return {
    page: whatsappPage(),
    event: overrides.event ?? whatsappEvent(),
    eventId: "evt_whatsapp_1",
    payloadVersion: 1,
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    deliveryEnabled: true,
    deliveryBlockedReason: null,
    recoverAfter: new Date("2026-08-13T18:02:00.000Z"),
  }
}

function whatsappEvent(
  overrides: Partial<WhatsappMessageEvent> = {}
): WhatsappMessageEvent {
  return {
    wabaId: "waba-1",
    providerPhoneNumberId: "phone-number-1",
    direction: "inbound",
    contactId: "5215555555555",
    senderId: "5215555555555",
    contactName: "Juana",
    providerMessageId: "wamid.1",
    type: "text",
    text: "hola",
    content: null,
    attachments: [],
    replyToProviderMessageId: null,
    origin: "customer",
    historical: false,
    deliveryStatus: null,
    errors: [],
    createdAt: WHATSAPP_CREATED_AT,
    ...overrides,
  }
}

// Un mensaje importado por la sync de Coexistence: entrante, pero de hace
// meses.
function whatsappHistoryEvent(): WhatsappMessageEvent {
  return whatsappEvent({
    origin: "history",
    historical: true,
    deliveryStatus: "read",
    providerMessageId: "wamid.history.1",
    createdAt: new Date("2026-02-01T10:00:00.000Z"),
  })
}

// Una notificación de WhatsApp —`user_changed_number` y compañía—: entrante y
// de ahora mismo, pero con `origin: "system"` porque no la escribió el contacto.
function whatsappSystemEvent(
  overrides: Partial<WhatsappMessageEvent> = {}
): WhatsappMessageEvent {
  return whatsappEvent({
    type: "system",
    text: null,
    content: {
      kind: "generic_event",
      eventType: "system",
      raw: { type: "user_changed_number", wa_id: "5215555555556" },
    },
    origin: "system",
    providerMessageId: "wamid.system.1",
    ...overrides,
  })
}

// Lo que el negocio escribió desde la WhatsApp Business App: saliente, pero con
// el cliente como contacto.
function whatsappEchoEvent(): WhatsappMessageEvent {
  return whatsappEvent({
    direction: "outbound",
    origin: "business_app",
    senderId: "5215550000000",
    contactName: null,
    providerMessageId: "wamid.echo.1",
  })
}

function whatsappIngestRow(overrides: Partial<Row> = {}): Row {
  return {
    message_id: WHATSAPP_MESSAGE_ID,
    job_id: WHATSAPP_JOB_ID,
    job_status: "pending",
    job_attempt_count: 0,
    job_recover_after: "2026-08-13T18:02:00.000Z",
    ...overrides,
  }
}

// Lo que devuelve el left join cuando no se creó job de entrega.
function withoutJob(): Partial<Row> {
  return {
    job_id: null,
    job_status: null,
    job_attempt_count: null,
    job_recover_after: null,
  }
}

function whatsappDuplicateRow(): Row {
  return {
    message_id: WHATSAPP_MESSAGE_ID,
    job_id: WHATSAPP_JOB_ID,
    job_status: "pending",
    job_attempt_count: 2,
    job_recover_after: "2026-08-13T18:02:00.000Z",
  }
}

function whatsappStatusInput(
  deliveryStatus: WhatsappStatusEvent["deliveryStatus"],
  errors: WhatsappStatusEvent["errors"] = []
): { page: PageRecord; event: WhatsappStatusEvent } {
  return {
    page: whatsappPage(),
    event: {
      wabaId: "waba-1",
      providerPhoneNumberId: "phone-number-1",
      providerMessageId: "wamid.1",
      deliveryStatus,
      recipientId: "5215555555555",
      timestamp: WHATSAPP_CREATED_AT,
      errors,
    },
  }
}

function whatsappContactEvent(
  overrides: Partial<WhatsappContactSyncEvent> = {}
): WhatsappContactSyncEvent {
  return {
    wabaId: "waba-1",
    providerPhoneNumberId: "phone-number-1",
    action: "add",
    phoneNumber: "+52 1 55 5555 5555",
    fullName: "Juana",
    firstName: "Juana",
    timestamp: WHATSAPP_CREATED_AT,
    ...overrides,
  }
}

// Simula la sentencia de estados **leyendo el rank del propio SQL bajo prueba**:
// si alguien reordena el array de la sentencia, este test cambia de resultado en
// vez de seguir verde contra una copia del orden que ya no rige.
function deliveryStatusSql(initial: string | null): { client: Sql } {
  let current = initial
  const tagged = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Row[]> => {
    const statement = strings.join("?")
    const ranking = readRanking(statement)
    const next = String(
      bindAfter({ statement, values }, "set delivery_status =")
    )
    const rankOf = (status: string | null) =>
      status === null ? 0 : ranking.indexOf(status) + 1
    const previous = current
    if (rankOf(next) <= rankOf(previous)) {
      return [
        {
          message_id: WHATSAPP_MESSAGE_ID,
          current_status: previous,
          applied_status: null,
        },
      ]
    }
    current = next
    return [
      {
        message_id: WHATSAPP_MESSAGE_ID,
        current_status: previous,
        applied_status: next,
      },
    ]
  }
  return {
    client: Object.assign(tagged, {
      query: async () => [],
      transaction: async () => [],
    }) as unknown as Sql,
  }
}

function readRanking(statement: string): string[] {
  const declared = statement.match(/array\[([^\]]*)\]::text\[\]/)?.[1]
  if (!declared) throw new Error("la sentencia de estados no declara el rank")
  return declared
    .split(",")
    .map((status) => status.trim().replaceAll("'", ""))
    .filter((status) => status !== "")
}

function attachmentJson(overrides: Partial<Row> = {}): Row {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    kind: "document",
    mimeType: "application/pdf",
    filename: "factura.pdf",
    caption: null,
    sizeBytes: 12345,
    sha256: null,
    status: "pending",
    ...overrides,
  }
}

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

// Los dos transportes comen de la misma cola: `reserveOutbound` encadena una
// lectura por `query` (la proyección compartida de mensajes, que va con
// parámetros posicionales) y escrituras por plantilla etiquetada, y con colas
// separadas el orden de los resultados dejaría de describir el orden real de las
// sentencias.
function fakeSql(results: Row[][]): Sql {
  const next = async () => results.shift() ?? []
  return Object.assign(next, {
    query: next,
    transaction: async () => [],
  }) as unknown as Sql
}

function capturingSql(results: Row[][]): {
  client: Sql
  taggedStatements: string[]
  // Los binds, junto a su sentencia, para poder afirmar sobre el valor exacto
  // que viaja (una ventana de 24 h que se abre, un adjunto sin mime type).
  taggedCalls: Array<{ statement: string; values: unknown[] }>
  // `query` es el otro transporte del repositorio, el de las lecturas con
  // filtros dinámicos. Contarlas por separado es lo que delata un N+1.
  queries: Array<{ text: string; parameters: unknown[] }>
} {
  const taggedStatements: string[] = []
  const taggedCalls: Array<{ statement: string; values: unknown[] }> = []
  const queries: Array<{ text: string; parameters: unknown[] }> = []
  const tagged = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const statement = strings.join("?")
    taggedStatements.push(statement)
    taggedCalls.push({ statement, values })
    return results.shift() ?? []
  }
  const client = Object.assign(tagged, {
    query: async (text: string, parameters: unknown[] = []) => {
      queries.push({ text, parameters })
      return results.shift() ?? []
    },
    transaction: async () => [],
  }) as unknown as Sql
  return { client, taggedStatements, taggedCalls, queries }
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

// Para WhatsApp `providerPageId` es el phone_number_id (0015 reusa
// `meta_page_id`), y el WABA y el modo de onboarding viajan aparte porque ese
// id no los dice.
function whatsappPage(): PageRecord {
  return {
    ...pageRecord(),
    channel: "whatsapp",
    providerPageId: "phone-number-1",
    wabaId: "waba-1",
    phoneE164: "+5215550000000",
    onboardingMode: "coexistence",
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
