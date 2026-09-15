import Link from "next/link"

import type { AppDict } from "@/content/i18n/app"
import { INBOX_TABS, inboxHref, type InboxTab } from "@/lib/inbox/inbox-tabs"
import { cn } from "@/lib/utils"

// Modo de Inbox como enlaces, no como `Tabs` de Radix (ADR 0005): el estado
// vive en `?tab=`, así que la navegación tiene que ser recargable, compartible
// y con botón atrás, y así la pantalla entera sigue siendo server component.
//
// Píldoras (mock `1i`, ADR 0018): la activa se rellena con el primario. Van
// sin contador a propósito: el modo que no está abierto no se consulta, y un
// número pediría una lectura más solo para decorar.
//
// Pasa el filtro de cuenta pero NO la selección: al cambiar de modo se conserva
// por qué cuenta estabas mirando y se cae en el elemento más reciente del modo
// nuevo, que es la conducta de auto-apertura que la pantalla ya tenía.
export function InboxTabsNav({
  active,
  accountId,
  t,
}: {
  active: InboxTab
  accountId: string | null
  t: AppDict
}) {
  return (
    <nav aria-label={t.inbox.tabsAria} className="flex gap-1">
      {INBOX_TABS.map((tab) => {
        const isActive = tab === active

        return (
          <Link
            key={tab}
            href={inboxHref({ tab, pageId: accountId })}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-full px-2.5 py-1 text-[12.5px] transition-colors",
              isActive
                ? "bg-primary font-medium text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {t.inbox.tabs[tab]}
          </Link>
        )
      })}
    </nav>
  )
}
