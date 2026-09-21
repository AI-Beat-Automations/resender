import { describe, expect, it } from "vitest"

import {
  DEFAULT_LOG_FILTERS,
  decodeLogCursor,
  encodeLogCursor,
  hasActiveLogFilters,
  logSearchParams,
  logsHref,
  parseLogFilters,
  parseSelectedLog,
} from "./log-filters"

const ACCOUNT = "11111111-1111-4111-8111-111111111111"
const LOG = "22222222-2222-4222-8222-222222222222"
const ALL = { kind: "all" } as const

describe("parseLogFilters", () => {
  it("sin parámetros devuelve los valores por defecto", () => {
    expect(parseLogFilters({}, [])).toEqual(DEFAULT_LOG_FILTERS)
  })

  it("descarta en silencio lo que no está en el catálogo", () => {
    expect(
      parseLogFilters(
        {
          periodo: "1y",
          estado: "failed,borrado,success",
          dir: "x",
          plataforma: "telegram,whatsapp",
          cuenta: "de-otro-tenant",
          http: "3xx",
          rel: "no-es-uuid",
          q: "  wamid.1  ",
        },
        [ACCOUNT]
      )
    ).toEqual({
      ...DEFAULT_LOG_FILTERS,
      // En el orden del catálogo, no en el de la URL.
      statuses: ["success", "failed"],
      channels: ["whatsapp"],
      search: "wamid.1",
    })
  })

  it("acepta una cuenta solo si está en la lista del actor", () => {
    expect(parseLogFilters({ cuenta: ACCOUNT }, [ACCOUNT]).accountId).toBe(
      ACCOUNT
    )
    expect(parseLogFilters({ cuenta: ACCOUNT }, []).accountId).toBeNull()
  })
})

describe("logsHref", () => {
  it("sin filtros es /logs a secas", () => {
    expect(logsHref(DEFAULT_LOG_FILTERS, ALL)).toBe("/logs")
    expect(hasActiveLogFilters(DEFAULT_LOG_FILTERS, ALL)).toBe(false)
  })

  it("es el inverso de parseLogFilters", () => {
    const filters = {
      ...DEFAULT_LOG_FILTERS,
      period: "7d" as const,
      statuses: ["failed" as const, "retrying" as const],
      directions: ["resender_to_bot" as const],
      accountId: ACCOUNT,
      http: "5xx" as const,
      search: "n8n.sonrisa.mx",
      relatedTo: LOG,
    }
    const href = logsHref(filters, { kind: "own" }, LOG)
    const params = logSearchParams(href)

    expect(parseLogFilters(params, [ACCOUNT])).toEqual(filters)
    expect(params.cliente).toBe("propias")
    expect(parseSelectedLog(params)).toBe(LOG)
    expect(hasActiveLogFilters(filters, ALL)).toBe(true)
  })
})

describe("cursor", () => {
  it("ida y vuelta conserva los microsegundos", () => {
    const cursor = { createdAt: "2026-09-03T14:02:11.123456Z", id: LOG }
    expect(decodeLogCursor(encodeLogCursor(cursor))).toEqual(cursor)
  })

  it("un cursor manipulado se ignora", () => {
    expect(decodeLogCursor("basura")).toBeNull()
    expect(decodeLogCursor(`no-fecha|${LOG}`)).toBeNull()
    expect(decodeLogCursor("2026-09-03T14:02:11Z|no-uuid")).toBeNull()
    expect(decodeLogCursor(null)).toBeNull()
  })
})
