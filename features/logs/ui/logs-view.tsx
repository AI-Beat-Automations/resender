"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, LoaderCircle, RefreshCw, ScrollText, Search } from "lucide-react"

import { useAppDict } from "@/content/i18n/app/provider"
import {
  fetchLogDetailAction,
  fetchLogsPageAction,
  refreshLogsAction,
  type LogsPage,
} from "@/features/logs/actions"
import {
  displayEndpoint,
  formatDuration,
  formatLogDate,
} from "@/features/logs/log-format"
import type { LogsAccountOption } from "@/features/logs/scope"
import type { ClientFilter, ClientName } from "@/lib/clients/client-filter"
import {
  DEFAULT_LOG_FILTERS,
  hasActiveLogFilters,
  logSearchParams,
  logsHref,
  type LogFilters,
} from "@/lib/logs/log-filters"
import type {
  RequestLogDetail,
  RequestLogFacets,
  RequestLogRow,
} from "@/lib/logs/read-model"
import { REQUEST_LOG_RETENTION_DAYS } from "@/lib/logs/retention"
import { cn } from "@/lib/utils"

import {
  LogChannel,
  LogDirection,
  LogEndpoint,
  LogHttpCode,
  LogStatus,
} from "./log-badges"
import { LogDetailSheet } from "./log-detail-sheet"
import { LogsFilterRail } from "./logs-filter-rail"

// La pantalla de Logs (mocks `1o` y `1n`): filtros | tabla | sheet.
//
// Los filtros viven en la URL y cambiarlos remonta este componente (la página
// le pone `key`), así que acá adentro la consulta es siempre la misma y lo que
// hay que manejar es solo lo que crece: más páginas por scroll y filas nuevas
// por polling. La fila abierta sí es estado local —abrirla no debe recargar la
// lista— y se refleja en `?log=` con `replaceState` para poder compartirla.

const POLL_MS = 5_000

const GRID_WIDE =
  "grid-cols-[132px_96px_150px_minmax(220px,1.4fr)_minmax(170px,1fr)_104px_60px_84px] gap-3"
const GRID_NARROW =
  "grid-cols-[122px_84px_140px_minmax(170px,1.4fr)_minmax(130px,1fr)_92px_48px_68px] gap-2.5"

export function LogsView({
  filters,
  clientFilter,
  clients,
  accounts,
  initialPage,
  initialFacets,
  initialSelected,
}: {
  filters: LogFilters
  clientFilter: ClientFilter
  clients: ClientName[]
  accounts: LogsAccountOption[]
  initialPage: LogsPage
  initialFacets: RequestLogFacets
  initialSelected: RequestLogDetail | null
}) {
  const dict = useAppDict()
  const t = dict.requestLogs
  const router = useRouter()

  const [rows, setRows] = useState(initialPage.rows)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [facets, setFacets] = useState(initialFacets)
  const [selectedId, setSelectedId] = useState(initialSelected?.id ?? null)
  const [detail, setDetail] = useState(initialSelected)
  const [live, setLive] = useState(true)
  const [loadingMore, startLoadMore] = useTransition()
  const [loadingDetail, startDetail] = useTransition()
  const [refreshing, startRefresh] = useTransition()

  const params = useMemo(
    () => logSearchParams(logsHref(filters, clientFilter)),
    [filters, clientFilter]
  )
  const clientNames = useMemo(
    () => new Map(clients.map((client) => [client.id, client.name])),
    [clients]
  )

  // -- Refresco: el polling y el botón hacen lo mismo --------------------------
  const refresh = useCallback(async () => {
    const fresh = await refreshLogsAction(params)
    if (!fresh) return
    setFacets(fresh.facets)
    setRows((current) => {
      const freshIds = new Set(fresh.rows.map((row) => row.id))
      // Si la primera página nueva no toca nada de lo que había, entraron más
      // filas de las que caben en una página: se reemplaza todo en vez de dejar
      // un hueco invisible en el medio.
      if (!current.some((row) => freshIds.has(row.id))) {
        setNextCursor(fresh.nextCursor)
        return fresh.rows
      }
      // Las frescas van arriba —con el estado al día de una entrega que seguía
      // reintentando— y debajo lo ya cargado que no vino repetido.
      const oldest = fresh.rows[fresh.rows.length - 1]
      return [
        ...fresh.rows,
        ...current.filter(
          (row) =>
            !freshIds.has(row.id) &&
            (!oldest || row.createdAt <= oldest.createdAt)
        ),
      ]
    })
  }, [params])

  // Polling suave: solo «en vivo», con la pestaña visible y sin detalle
  // abierto, para no mover la tabla debajo de quien está leyendo una fila.
  const polling = live && selectedId === null
  useEffect(() => {
    if (!polling) return
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [polling, refresh])

  // -- Scroll infinito -----------------------------------------------------------
  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return
    startLoadMore(async () => {
      const page = await fetchLogsPageAction(params, nextCursor)
      setRows((current) => {
        const seen = new Set(current.map((row) => row.id))
        return [...current, ...page.rows.filter((row) => !seen.has(row.id))]
      })
      setNextCursor(page.nextCursor)
    })
  }, [nextCursor, loadingMore, params])

  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node || !nextCursor) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: "240px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [nextCursor, loadMore])

  // -- Selección -----------------------------------------------------------------
  function select(id: string | null) {
    setSelectedId(id)
    window.history.replaceState(null, "", logsHref(filters, clientFilter, id))
    if (!id) {
      setDetail(null)
      return
    }
    startDetail(async () => {
      setDetail(await fetchLogDetailAction(id))
    })
  }

  function refreshNow() {
    startRefresh(async () => {
      await refresh()
      if (selectedId) setDetail(await fetchLogDetailAction(selectedId))
    })
  }

  const sheetOpen = selectedId !== null
  const grid = sheetOpen ? GRID_NARROW : GRID_WIDE
  const filtered = hasActiveLogFilters(filters, clientFilter)

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-card">
      <LogsFilterRail
        filters={filters}
        clientFilter={clientFilter}
        clients={clients}
        accounts={accounts}
        facets={facets}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border-subtle px-5">
          <SearchBox
            initial={filters.search}
            placeholder={t.searchPlaceholder}
            onSearch={(search) =>
              router.replace(logsHref({ ...filters, search }, clientFilter))
            }
          />
          <button
            type="button"
            onClick={() => setLive((value) => !value)}
            aria-pressed={live}
            className="inline-flex h-[34px] shrink-0 items-center gap-2 rounded-full border border-border px-3 text-[12.5px] hover:bg-accent"
          >
            <span
              className={cn(
                "size-[7px] rounded-full",
                polling ? "bg-success" : "bg-[var(--text-subtle)]"
              )}
              aria-hidden
            />
            {polling ? t.live : t.livePaused}
          </button>
          <button
            type="button"
            onClick={refreshNow}
            title={t.refresh}
            aria-label={t.refresh}
            className="flex size-[34px] shrink-0 items-center justify-center rounded-[8px] border border-border text-text-secondary hover:bg-accent"
          >
            <RefreshCw
              className={cn("size-[15px]", refreshing && "animate-spin")}
              aria-hidden
            />
          </button>
        </div>

        {filters.relatedTo && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface-sunken px-5 py-2 text-[12.5px] text-text-secondary">
            {t.relatedBanner}
            <Link
              href={logsHref(DEFAULT_LOG_FILTERS, { kind: "all" })}
              className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
            >
              {t.relatedClear}
            </Link>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3.5 bg-surface-sunken p-10 text-center">
            <span
              className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
              aria-hidden
            >
              <ScrollText className="size-[22px]" />
            </span>
            <div className="max-w-[420px]">
              <h2 className="font-heading text-[18px] font-semibold tracking-[-0.02em]">
                {filtered ? t.emptyFiltered.title : t.empty.title}
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                {filtered ? t.emptyFiltered.body : t.empty.body}
              </p>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[860px]">
              <div
                className={cn(
                  "sticky top-0 z-10 grid items-center border-b border-border-subtle bg-surface-sunken px-5 py-[9px] font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground uppercase",
                  grid
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {t.columns.date}
                  <ArrowDown className="size-[11px]" aria-hidden />
                </span>
                <span>{t.columns.status}</span>
                <span>{t.columns.direction}</span>
                <span>{t.columns.endpoint}</span>
                <span>{t.columns.account}</span>
                <span>{t.columns.channel}</span>
                <span>{t.columns.http}</span>
                <span>{t.columns.duration}</span>
              </div>

              {rows.map((row) => (
                <LogRow
                  key={row.id}
                  row={row}
                  grid={grid}
                  selected={row.id === selectedId}
                  clientName={
                    row.clientAccountId
                      ? (clientNames.get(row.clientAccountId) ?? null)
                      : null
                  }
                  onSelect={() => select(row.id === selectedId ? null : row.id)}
                />
              ))}

              <div
                ref={sentinel}
                className="flex items-center justify-center gap-2 border-t border-border-subtle px-5 py-2.5 text-[12.5px] text-muted-foreground"
              >
                {nextCursor ? (
                  <>
                    <LoaderCircle
                      className={cn("size-3.5", loadingMore && "animate-spin")}
                      aria-hidden
                    />
                    {t.loadingMore.replace(
                      "{days}",
                      String(REQUEST_LOG_RETENTION_DAYS)
                    )}
                  </>
                ) : (
                  t.endOfList.replace(
                    "{days}",
                    String(REQUEST_LOG_RETENTION_DAYS)
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {sheetOpen && (
        <LogDetailSheet
          detail={detail}
          loading={loadingDetail}
          clientName={
            detail?.clientAccountId
              ? (clientNames.get(detail.clientAccountId) ?? null)
              : null
          }
          relatedHref={
            detail && filters.relatedTo !== detail.id
              ? logsHref(
                  { ...DEFAULT_LOG_FILTERS, relatedTo: detail.id },
                  { kind: "all" },
                  detail.id
                )
              : null
          }
          onClose={() => select(null)}
        />
      )}
    </div>
  )
}

function LogRow({
  row,
  grid,
  selected,
  clientName,
  onSelect,
}: {
  row: RequestLogRow
  grid: string
  selected: boolean
  clientName: string | null
  onSelect: () => void
}) {
  const dict = useAppDict()
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "grid w-full items-center border-b border-border-faint px-5 py-[11px] text-left text-[13px] outline-none focus-visible:bg-accent",
        grid,
        selected
          ? "bg-accent shadow-[inset_2px_0_0_var(--primary)]"
          : "hover:bg-surface-sunken"
      )}
    >
      <span
        className="font-mono text-[11.5px] text-text-secondary"
        suppressHydrationWarning
      >
        {formatLogDate(row.createdAt, dict.intl)}
      </span>
      <LogStatus status={row.status} />
      <LogDirection
        direction={row.direction}
        label={dict.requestLogs.directions[row.direction]}
      />
      <LogEndpoint
        method={row.method}
        endpoint={displayEndpoint(row.endpoint) || "—"}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12.5px]">{row.accountName ?? "—"}</span>
        <span className="truncate font-mono text-[10.5px] text-[var(--text-subtle)]">
          {row.accountExternalId}
          {clientName && ` · ${clientName}`}
        </span>
      </span>
      <span>
        <LogChannel label={dict.channels.label[row.channel]} />
      </span>
      <span>
        <LogHttpCode code={row.httpStatus} />
      </span>
      <span className="font-mono text-[11.5px] text-muted-foreground">
        {formatDuration(row.durationMs)}
      </span>
    </button>
  )
}

// Buscador con debounce: escribe en `?q=` al dejar de tipear, o con Enter.
function SearchBox({
  initial,
  placeholder,
  onSearch,
}: {
  initial: string
  placeholder: string
  onSearch: (value: string) => void
}) {
  const [value, setValue] = useState(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function commit(next: string) {
    if (timer.current) clearTimeout(timer.current)
    if (next.trim() !== initial) onSearch(next.trim())
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return (
    <label className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-border bg-background px-2.5 focus-within:ring-3 focus-within:ring-ring/50">
      <Search className="size-[15px] shrink-0 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => {
          const next = event.target.value
          setValue(next)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => commit(next), 450)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(value)
        }}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-subtle)]"
      />
    </label>
  )
}
