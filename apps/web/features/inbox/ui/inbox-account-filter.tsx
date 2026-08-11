import Link from "next/link"

import { inboxHref, type InboxTab } from "@/lib/inbox/inbox-tabs"
import { Badge } from "@workspace/ui/components/badge"

// Filtro por cuenta conectada (spec C.1): el par seleccionado/no seleccionado
// son las variantes `default` / `outline` del Badge. Son enlaces, así que la
// pantalla sigue siendo server component.
//
// Dice «cuentas» y no «páginas» desde la ADR 0008: `connected_pages` dejó de
// ser páginas de Facebook y hoy mezcla Messenger e Instagram.

export type InboxFilterAccount = {
  id: string
  name: string
}

export function InboxAccountFilter({
  tab,
  accounts,
  selectedAccountId,
}: {
  tab: InboxTab
  accounts: InboxFilterAccount[]
  selectedAccountId: string | null
}) {
  // Sin cuentas no hay nada que filtrar: una fila con una sola píldora
  // «Todas las cuentas» es un control que no hace nada.
  if (accounts.length === 0) return null

  return (
    <div className="mt-3.5 flex flex-wrap gap-2">
      <FilterPill
        href={inboxHref({ tab })}
        label="Todas las cuentas"
        active={!selectedAccountId}
      />
      {accounts.map((account) => (
        <FilterPill
          key={account.id}
          href={inboxHref({ tab, pageId: account.id })}
          label={account.name}
          active={selectedAccountId === account.id}
        />
      ))}
    </div>
  )
}

function FilterPill({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <Badge
      asChild
      variant={active ? "default" : "outline"}
      className="h-6 px-3"
    >
      <Link href={href} aria-current={active ? "page" : undefined}>
        {label}
      </Link>
    </Badge>
  )
}
