import Link from "next/link"

import type { AppDict } from "@/content/i18n/app"
import { INBOX_TABS, inboxHref, type InboxTab } from "@/lib/inbox/inbox-tabs"
import { cn } from "@workspace/ui/lib/utils"

// Modo de Inbox como píldoras (mock 1h/1i), pero el estado sigue en `?tab=`
// (ADR 0005): cada píldora es un `Link`, así que la navegación es recargable,
// compartible y con botón atrás, y la página entera sigue renderizando el modo
// en servidor.
//
// Pasa el filtro de cuenta pero NO la selección: al cambiar de modo se conserva
// por qué cuenta estabas mirando y se cae en el elemento más reciente del modo
// nuevo, que es la conducta de auto-apertura que la pantalla ya tenía.
//
// El contador solo se pinta en las pestañas cuyo dato existe: la página
// consulta un modo por petición, así que normalmente es solo el activo.
export function InboxTabsNav({
  active,
  accountId,
  counts,
  t,
}: {
  active: InboxTab
  accountId: string | null
  counts: Partial<Record<InboxTab, number>>
  t: AppDict
}) {
  return (
    <nav aria-label={t.inbox.tabsAria} className="flex items-center gap-1">
      {INBOX_TABS.map((tab) => {
        const isActive = tab === active
        const count = counts[tab]
        return (
          <Link
            key={tab}
            href={inboxHref({ tab, pageId: accountId })}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] transition-colors",
              isActive
                ? "bg-foreground font-medium text-background"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {t.inbox.tabs[tab]}
            {count !== undefined ? (
              <span
                className={cn(
                  "font-mono text-[11px]",
                  isActive ? "opacity-70" : "text-[var(--text-subtle)]"
                )}
              >
                {count.toLocaleString(t.intl)}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
