"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"

import { useAppDict } from "@/content/i18n/app/provider"
import type { LogsAccountOption } from "@/features/logs/scope"
import {
  OWN_CLIENT_FILTER,
  clientFilterParam,
  type ClientFilter,
  type ClientName,
} from "@/lib/clients/client-filter"
import {
  DEFAULT_LOG_FILTERS,
  LOG_CHANNELS,
  LOG_DIRECTIONS,
  LOG_HTTP_CLASSES,
  LOG_PERIODS,
  LOG_STATUSES,
  hasActiveLogFilters,
  logsHref,
  type LogFilters,
} from "@/lib/logs/log-filters"
import type { RequestLogFacets } from "@/lib/logs/read-model"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// Panel de filtros de Logs (mock `1o`): 212 px, un grupo por faceta. No guarda
// estado: cada control navega a la URL que resulta de cambiarlo (`logsHref`), y
// el servidor vuelve a pintar la lista con esos filtros.

const ALL = "__all__"

export function LogsFilterRail({
  filters,
  clientFilter,
  clients,
  accounts,
  facets,
}: {
  filters: LogFilters
  clientFilter: ClientFilter
  clients: ClientName[]
  accounts: LogsAccountOption[]
  facets: RequestLogFacets
}) {
  const dict = useAppDict()
  const t = dict.requestLogs
  const router = useRouter()

  const go = (next: Partial<LogFilters>, nextClient = clientFilter) =>
    router.push(logsHref({ ...filters, ...next }, nextClient))

  function toggle<K extends "statuses" | "directions" | "channels">(
    key: K,
    value: LogFilters[K][number],
    catalog: readonly LogFilters[K][number][]
  ) {
    const current = filters[key] as readonly string[]
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
    // En el orden del catálogo, para que la URL no dependa del orden de clics.
    go({ [key]: catalog.filter((item) => next.includes(item)) })
  }

  const count = (value: number) => value.toLocaleString(dict.intl)

  return (
    <section className="flex w-[212px] shrink-0 flex-col overflow-y-auto border-r border-border-subtle bg-card px-3.5">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border-subtle">
        <h1 className="font-heading text-[16px] font-semibold">{t.title}</h1>
        {hasActiveLogFilters(filters, clientFilter) && (
          <Link
            href={logsHref(DEFAULT_LOG_FILTERS, { kind: "all" })}
            className="rounded-[6px] border border-border px-2 py-[3px] text-[12px] text-muted-foreground hover:bg-accent"
          >
            {t.clear}
          </Link>
        )}
      </div>

      <Group title={t.filters.period}>
        <RailSelect
          label={t.filters.period}
          value={filters.period}
          options={LOG_PERIODS.map((period) => ({
            value: period,
            label: t.periods[period],
          }))}
          onChange={(period) =>
            go({ period: period as LogFilters["period"] })
          }
        />
      </Group>

      <Group title={t.filters.status}>
        {LOG_STATUSES.map((status) => (
          <CheckRow
            key={status}
            label={t.statuses[status]}
            count={count(facets.status[status])}
            checked={filters.statuses.includes(status)}
            onToggle={() => toggle("statuses", status, LOG_STATUSES)}
          />
        ))}
      </Group>

      <Group title={t.filters.direction}>
        {LOG_DIRECTIONS.map((direction) => (
          <CheckRow
            key={direction}
            label={t.directions[direction]}
            count={count(facets.direction[direction])}
            checked={filters.directions.includes(direction)}
            onToggle={() => toggle("directions", direction, LOG_DIRECTIONS)}
          />
        ))}
      </Group>

      <Group title={t.filters.platform}>
        {LOG_CHANNELS.map((channel) => (
          <CheckRow
            key={channel}
            label={dict.channels.label[channel]}
            checked={filters.channels.includes(channel)}
            onToggle={() => toggle("channels", channel, LOG_CHANNELS)}
          />
        ))}
      </Group>

      {/* Solo para un padre con clientes: sin ellos «Todos» y «Mis
          conexiones» dicen lo mismo (igual que en Inbox). */}
      {clients.length > 0 && (
        <Group title={t.filters.client}>
          <RailSelect
            label={t.filters.client}
            value={clientFilterParam(clientFilter) ?? ALL}
            options={[
              { value: ALL, label: dict.clients.filterAll },
              { value: OWN_CLIENT_FILTER, label: dict.clients.filterOwn },
              ...clients.map((client) => ({
                value: client.id,
                label: client.name,
              })),
            ]}
            onChange={(value) =>
              // Cambiar de cliente suelta la conexión: lo más probable es que
              // ya no sea suya.
              go(
                { accountId: null },
                value === ALL
                  ? { kind: "all" }
                  : value === OWN_CLIENT_FILTER
                    ? { kind: "own" }
                    : { kind: "client", clientAccountId: value }
              )
            }
          />
        </Group>
      )}

      <Group title={t.filters.account}>
        <RailSelect
          label={t.filters.account}
          value={filters.accountId ?? ALL}
          options={[
            { value: ALL, label: t.filters.allAccounts },
            ...accounts.map((account) => ({
              value: account.id,
              label: account.label,
            })),
          ]}
          onChange={(value) => go({ accountId: value === ALL ? null : value })}
        />
      </Group>

      <Group title={t.filters.http} last>
        <RailSelect
          label={t.filters.http}
          value={filters.http ?? ALL}
          options={[
            { value: ALL, label: t.filters.anyHttp },
            ...LOG_HTTP_CLASSES.map((http) => ({
              value: http,
              label: t.httpClasses[http],
            })),
          ]}
          onChange={(value) =>
            go({ http: value === ALL ? null : (value as LogFilters["http"]) })
          }
        />
      </Group>
    </section>
  )
}

function Group({
  title,
  last = false,
  children,
}: {
  title: string
  last?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 py-3.5",
        !last && "border-b border-border-subtle"
      )}
    >
      <h2 className="text-[13px] font-medium">{title}</h2>
      {children}
    </div>
  )
}

function CheckRow({
  label,
  count,
  checked,
  onToggle,
}: {
  label: string
  count?: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px]">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="size-[15px] rounded-[4px]"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          checked ? "text-foreground" : "text-text-secondary"
        )}
      >
        {label}
      </span>
      {count !== undefined && (
        <span className="font-mono text-[11px] text-[var(--text-subtle)]">
          {count}
        </span>
      )}
    </label>
  )
}

// El «select» del mock: caja de 34 px con chevron. El kit no trae uno, así que
// va sobre el DropdownMenu con radio items, que ya resuelve foco y teclado.
function RailSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const selected = options.find((option) => option.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="flex h-[34px] w-full items-center justify-between gap-2 rounded-[8px] border border-border bg-background px-2.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          className="size-3 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[320px] w-[var(--radix-dropdown-menu-trigger-width)] min-w-[184px]"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span className="truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
