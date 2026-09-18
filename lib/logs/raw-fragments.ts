// El fragmento crudo de **un** evento dentro de un POST de Meta, para el bloque
// «payload recibido» de la sección Logs.
//
// Un mismo POST puede traer eventos de varias cuentas —y por tanto de varios
// tenants—, así que lo que se guarda por fila nunca es el body entero: es el
// `entry` reducido a ese único evento. Así ningún tenant ve datos de otro.
//
// Va aparte de los parsers a propósito. Los parsers producen el evento neutro
// (`InboundEvent`) y no cargan el crudo; enhebrarlo por ellos habría tocado los
// tres canales y sus tests para servir a una pantalla. Acá se recorre el mismo
// body una segunda vez, indexado por el id que el parser ya expone, y la
// ingesta lo busca con ese id. Si no aparece (un postback sin `mid`, una forma
// que Meta cambió), el llamador cae al evento normalizado: la fila se escribe
// igual.
// Módulo puro: sin DB, sin Next.

import type { PageChannel } from "@/lib/pages/page-registry"

export type RawFragmentIndex = {
  /** Mensaje, postback o echo, por `mid` / `wamid`. */
  message(providerId: string | null | undefined): unknown | null
  /** Acuse de WhatsApp: el mismo wamid llega una vez por estado. */
  status(providerId: string, deliveryStatus: string): unknown | null
  /** Comentario de Instagram, por id de comentario. */
  comment(igCommentId: string): unknown | null
}

// Las listas del `value` de WhatsApp que se reducen a un solo elemento.
const ITEM_KEYS = new Set(["messages", "statuses", "message_echoes"])

const EMPTY: RawFragmentIndex = {
  message: () => null,
  status: () => null,
  comment: () => null,
}

export function indexRawFragments(
  body: unknown,
  channel: PageChannel
): RawFragmentIndex {
  try {
    return buildIndex(body, channel)
  } catch {
    // El crudo es decorativo: un body con una forma inesperada no puede tirar
    // la ingesta que lo está indexando.
    return EMPTY
  }
}

function buildIndex(body: unknown, channel: PageChannel): RawFragmentIndex {
  const messages = new Map<string, unknown>()
  const statuses = new Map<string, unknown>()
  const comments = new Map<string, unknown>()

  for (const entry of asArray(asRecord(body)?.entry)) {
    const entryRecord = asRecord(entry)
    if (!entryRecord) continue
    const envelope = { id: entryRecord.id, time: entryRecord.time }

    if (channel !== "whatsapp") {
      for (const event of asArray(entryRecord.messaging)) {
        const record = asRecord(event)
        const mid =
          asString(asRecord(record?.message)?.mid) ??
          asString(asRecord(record?.postback)?.mid)
        if (mid) messages.set(mid, { ...envelope, messaging: [event] })
      }
      // Los comentarios llegan en `changes[]`, o aplanados en el propio
      // `entry` (misma tolerancia que `extractInstagramComments`).
      const changes = [
        ...asArray(entryRecord.changes),
        ...(entryRecord.field !== undefined || entryRecord.value !== undefined
          ? [{ field: entryRecord.field, value: entryRecord.value }]
          : []),
      ]
      for (const change of changes) {
        const value = asRecord(asRecord(change)?.value)
        const id = asString(value?.id) ?? asString(value?.comment_id)
        if (id) comments.set(id, { ...envelope, changes: [change] })
      }
      continue
    }

    for (const change of asArray(entryRecord.changes)) {
      const changeRecord = asRecord(change)
      const value = asRecord(changeRecord?.value)
      if (!changeRecord || !value) continue
      // El `value` de WhatsApp agrupa N mensajes y N acuses bajo un mismo
      // `metadata`/`contacts`: el fragmento conserva el contexto y deja solo
      // el elemento de esta fila.
      const context = Object.fromEntries(
        Object.entries(value).filter(([key]) => !ITEM_KEYS.has(key))
      )
      const wrap = (key: string, item: unknown) => ({
        ...envelope,
        changes: [
          { field: changeRecord.field, value: { ...context, [key]: [item] } },
        ],
      })

      for (const key of ["messages", "message_echoes"] as const) {
        for (const item of asArray(value[key])) {
          const id = asString(asRecord(item)?.id)
          if (id) messages.set(id, wrap(key, item))
        }
      }
      for (const item of asArray(value.statuses)) {
        const record = asRecord(item)
        const id = asString(record?.id)
        const status = asString(record?.status)
        if (id && status) statuses.set(`${id}:${status}`, wrap("statuses", item))
      }
    }
  }

  return {
    message: (id) => (id ? (messages.get(id) ?? null) : null),
    status: (id, status) => statuses.get(`${id}:${status}`) ?? null,
    comment: (id) => comments.get(id) ?? null,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}
