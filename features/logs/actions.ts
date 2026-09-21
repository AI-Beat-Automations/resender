"use server"

import type { LogSearchParams } from "@/lib/logs/log-filters"
import { isUuid } from "@/lib/logs/log-filters"
import {
  countRequestLogFacets,
  getRequestLog,
  listRequestLogs,
  type RequestLogDetail,
  type RequestLogFacets,
  type RequestLogRow,
} from "@/lib/logs/read-model"

import { resolveLogsScope } from "./scope"

// Lecturas de la sección Logs que el cliente pide después del primer render:
// la página siguiente del scroll, el refresco del polling y el detalle de una
// fila. Son actions y no route handlers porque el repo no tiene capa de fetch
// en el cliente. Las tres vuelven a resolver sesión, actor y filtros en el
// servidor: lo que manda el navegador es solo la URL cruda.

export type LogsPage = { rows: RequestLogRow[]; nextCursor: string | null }

export async function fetchLogsPageAction(
  params: LogSearchParams,
  cursor: string
): Promise<LogsPage> {
  const scope = await resolveLogsScope(params)
  if (!scope) return { rows: [], nextCursor: null }
  return listRequestLogs({ ...scope, cursor })
}

export async function refreshLogsAction(
  params: LogSearchParams
): Promise<(LogsPage & { facets: RequestLogFacets }) | null> {
  const scope = await resolveLogsScope(params)
  if (!scope) return null
  const [page, facets] = await Promise.all([
    listRequestLogs(scope),
    countRequestLogFacets(scope),
  ])
  return { ...page, facets }
}

export async function fetchLogDetailAction(
  id: string
): Promise<RequestLogDetail | null> {
  if (!isUuid(id)) return null
  const scope = await resolveLogsScope({})
  if (!scope) return null
  return getRequestLog(scope.tenantId, id)
}
