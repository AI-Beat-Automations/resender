// Filtros de la sección Logs. Viven en la URL (ADR 0005: el estado de la
// pantalla va en la URL, no en React), así un link con los filtros puestos se
// puede compartir. Todo lo que llega es entrada del usuario: un valor que no
// está en el catálogo se descarta en silencio, igual que `?page=` en Inbox.
// Módulo puro: sin React, sin Next, sin DB.

import {
  CLIENT_FILTER_PARAM,
  clientFilterParam,
  type ClientFilter,
} from "@/lib/clients/client-filter"
import type { PageChannel } from "@/lib/pages/page-registry"

import type { RequestLogDirection, RequestLogStatus } from "./request-log"

export const LOG_PERIODS = ["1h", "24h", "7d", "30d"] as const
export type LogPeriod = (typeof LOG_PERIODS)[number]
export const DEFAULT_LOG_PERIOD: LogPeriod = "24h"

const PERIOD_MS: Record<LogPeriod, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
}

export const LOG_STATUSES = [
  "success",
  "failed",
  "retrying",
  "skipped",
] as const satisfies readonly RequestLogStatus[]

export const LOG_DIRECTIONS = [
  "meta_to_resender",
  "resender_to_bot",
  "bot_to_resender",
] as const satisfies readonly RequestLogDirection[]

export const LOG_CHANNELS = [
  "messenger",
  "instagram",
  "whatsapp",
] as const satisfies readonly PageChannel[]

export const LOG_HTTP_CLASSES = ["2xx", "4xx", "5xx"] as const
export type LogHttpClass = (typeof LOG_HTTP_CLASSES)[number]

/** Nombres de los `searchParams`. En español, como las rutas del módulo. */
export const LOG_PARAMS = {
  period: "periodo",
  status: "estado",
  direction: "dir",
  channel: "plataforma",
  client: CLIENT_FILTER_PARAM,
  account: "cuenta",
  http: "http",
  search: "q",
  related: "rel",
  selected: "log",
} as const

export type LogFilters = {
  period: LogPeriod
  statuses: RequestLogStatus[]
  directions: RequestLogDirection[]
  channels: PageChannel[]
  /** Id de la conexión (`connected_pages.id`), ya validado contra la lista. */
  accountId: string | null
  http: LogHttpClass | null
  search: string
  /** «Ver relacionados»: id de la fila cuyos parientes se listan. */
  relatedTo: string | null
}

export const DEFAULT_LOG_FILTERS: LogFilters = {
  period: DEFAULT_LOG_PERIOD,
  statuses: [],
  directions: [],
  channels: [],
  accountId: null,
  http: null,
  search: "",
  relatedTo: null,
}

type Param = string | string[] | undefined
export type LogSearchParams = Record<string, Param>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function first(param: Param): string | undefined {
  return Array.isArray(param) ? param[0] : param
}

function list<T extends string>(param: Param, allowed: readonly T[]): T[] {
  const values = (first(param) ?? "").split(",")
  // En el orden del catálogo y sin repetidos: la URL canónica no depende del
  // orden en que se tildaron las casillas.
  return allowed.filter((value) => values.includes(value))
}

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID.test(value)
}

export function parseLogFilters(
  params: LogSearchParams,
  /** Conexiones que el filtro de cuenta puede elegir, ya acotadas por cliente. */
  accountIds: readonly string[]
): LogFilters {
  const period = first(params[LOG_PARAMS.period])
  const http = first(params[LOG_PARAMS.http])
  const account = first(params[LOG_PARAMS.account])
  const related = first(params[LOG_PARAMS.related])
  return {
    period: LOG_PERIODS.includes(period as LogPeriod)
      ? (period as LogPeriod)
      : DEFAULT_LOG_PERIOD,
    statuses: list(params[LOG_PARAMS.status], LOG_STATUSES),
    directions: list(params[LOG_PARAMS.direction], LOG_DIRECTIONS),
    channels: list(params[LOG_PARAMS.channel], LOG_CHANNELS),
    accountId: account && accountIds.includes(account) ? account : null,
    http: LOG_HTTP_CLASSES.includes(http as LogHttpClass)
      ? (http as LogHttpClass)
      : null,
    search: (first(params[LOG_PARAMS.search]) ?? "").trim().slice(0, 200),
    relatedTo: isUuid(related) ? related : null,
  }
}

/** Los `searchParams` crudos de un href de la pantalla, para mandarlos a una
 * server action: el servidor los vuelve a validar con `parseLogFilters`. */
export function logSearchParams(href: string): Record<string, string> {
  const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : ""
  return Object.fromEntries(new URLSearchParams(query))
}

/** Id del log abierto en el sheet, si la URL trae uno con forma de uuid. */
export function parseSelectedLog(params: LogSearchParams): string | null {
  const value = first(params[LOG_PARAMS.selected])
  return isUuid(value) ? value : null
}

export function periodStart(period: LogPeriod, now: Date): Date {
  return new Date(now.getTime() - PERIOD_MS[period])
}

/** Si hay algo que «Limpiar»: cualquier filtro fuera de su valor por defecto. */
export function hasActiveLogFilters(
  filters: LogFilters,
  clientFilter: ClientFilter
): boolean {
  return (
    filters.period !== DEFAULT_LOG_PERIOD ||
    filters.statuses.length > 0 ||
    filters.directions.length > 0 ||
    filters.channels.length > 0 ||
    filters.accountId !== null ||
    filters.http !== null ||
    filters.search.length > 0 ||
    filters.relatedTo !== null ||
    clientFilter.kind !== "all"
  )
}

/**
 * Único constructor de enlaces de la pantalla. Los valores por defecto no se
 * escriben, así `/logs` a secas es la URL canónica de «sin filtros».
 */
export function logsHref(
  filters: LogFilters,
  clientFilter: ClientFilter,
  selectedLogId?: string | null
): string {
  const query = new URLSearchParams()
  if (filters.period !== DEFAULT_LOG_PERIOD) {
    query.set(LOG_PARAMS.period, filters.period)
  }
  if (filters.statuses.length > 0) {
    query.set(LOG_PARAMS.status, filters.statuses.join(","))
  }
  if (filters.directions.length > 0) {
    query.set(LOG_PARAMS.direction, filters.directions.join(","))
  }
  if (filters.channels.length > 0) {
    query.set(LOG_PARAMS.channel, filters.channels.join(","))
  }
  const client = clientFilterParam(clientFilter)
  if (client) query.set(LOG_PARAMS.client, client)
  if (filters.accountId) query.set(LOG_PARAMS.account, filters.accountId)
  if (filters.http) query.set(LOG_PARAMS.http, filters.http)
  if (filters.search) query.set(LOG_PARAMS.search, filters.search)
  if (filters.relatedTo) query.set(LOG_PARAMS.related, filters.relatedTo)
  if (selectedLogId) query.set(LOG_PARAMS.selected, selectedLogId)
  const text = query.toString()
  return text ? `/logs?${text}` : "/logs"
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export type LogCursor = { createdAt: string; id: string }

/** `(created_at, id)` de la última fila vista, opaco para el cliente. */
export function encodeLogCursor(cursor: LogCursor): string {
  return `${cursor.createdAt}|${cursor.id}`
}

export function decodeLogCursor(value: string | null | undefined): LogCursor | null {
  if (!value) return null
  const [createdAt, id] = value.split("|")
  if (!createdAt || !isUuid(id)) return null
  return Number.isNaN(new Date(createdAt).getTime()) ? null : { createdAt, id }
}
