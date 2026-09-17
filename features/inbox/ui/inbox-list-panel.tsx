import type { ReactNode } from "react"

import {
  ClientFilterCombobox,
  type ClientFilterOption,
} from "@/features/clients/ui/client-filter-combobox"
import type { AppDict } from "@/content/i18n/app"
import type { InboxTab } from "@/lib/inbox/inbox-tabs"

import {
  InboxAccountCombobox,
  type InboxFilterAccount,
} from "./inbox-account-combobox"
import { InboxTabsNav } from "./inbox-tabs-nav"

// Panel izquierdo de Inbox (mock `1h`/`1i`, ADR 0018): 380px, cabecera de 52px
// con el título y el total, la píldora «solo lectura», y debajo la fila de
// controles —modo a la izquierda, cuenta a la derecha—. Los dos modos lo
// comparten; lo que cambia es la lista que va dentro.
//
// La píldora «solo lectura» vive acá y no en la cabecera del hilo: declara lo
// que la pantalla entera no tiene (compositor), no lo que le falta a un hilo.
export function InboxListPanel({
  tab,
  count,
  accounts,
  selectedAccountId,
  clientFilter,
  t,
  children,
}: {
  tab: InboxTab
  /** Filas del modo activo tras el filtro: el número del badge. */
  count: number
  accounts: InboxFilterAccount[]
  selectedAccountId: string | null
  /**
   * Filtro por cliente del padre (issue #154, ticket 4): las opciones con su
   * href y el valor de `?cliente=` seleccionado. Null = no se monta (el actor
   * es un cliente, o el padre no tiene clientes todavía).
   */
  clientFilter: {
    options: ClientFilterOption[]
    selectedId: string | null
  } | null
  t: AppDict
  children: ReactNode
}) {
  return (
    <section className="flex w-[380px] shrink-0 flex-col border-r border-border-subtle bg-card">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <h1 className="flex items-center gap-2 font-heading text-[16px] font-semibold">
          {t.inbox.title}
          <span className="rounded-[5px] bg-accent px-1.5 py-px font-mono text-[11px] font-normal text-text-secondary">
            {count}
          </span>
        </h1>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-[9px] py-[3px] text-[11.5px] text-muted-foreground">
          <span
            className="size-1.5 rounded-full bg-[var(--text-subtle)]"
            aria-hidden
          />
          {t.inbox.readOnly}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 px-4 pt-3">
        <InboxTabsNav
          active={tab}
          accountId={selectedAccountId}
          clientFilter={clientFilter?.selectedId ?? null}
          t={t}
        />
        <div className="flex items-center gap-1.5">
          {clientFilter ? (
            <ClientFilterCombobox
              options={clientFilter.options}
              selectedId={clientFilter.selectedId}
            />
          ) : null}
          {/* Sin cuentas no hay nada que filtrar: un desplegable con una sola
              opción «Todas las cuentas» es un control que no hace nada. */}
          {accounts.length > 0 ? (
            <InboxAccountCombobox
              tab={tab}
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              clientFilter={clientFilter?.selectedId ?? null}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto border-t border-border-faint">
        {children}
      </div>
    </section>
  )
}
