import Link from "next/link"

import type { AppDict } from "@/content/i18n/app"
import { INBOX_TABS, inboxHref, type InboxTab } from "@/lib/inbox/inbox-tabs"
import { cn } from "@workspace/ui/lib/utils"

// Modo de Inbox como enlaces, no como `Tabs` de Radix (ADR 0005): el estado
// vive en `?tab=`, así que la navegación tiene que ser recargable, compartible
// y con botón atrás, y así la pantalla entera sigue siendo server component.
// Es el mismo componente que las pestañas de Ajustes.
//
// Subrayado y no píldoras a propósito: debajo va el filtro por cuenta, que sí
// son píldoras. Dos filas de píldoras idénticas no dejarían ver cuál cambia de
// pantalla y cuál filtra la que ya estás viendo.
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
    <nav aria-label={t.inbox.tabsAria} className="mt-4 flex gap-1">
      {INBOX_TABS.map((tab) => {
        const isActive = tab === active

        return (
          <Link
            key={tab}
            href={inboxHref({ tab, pageId: accountId })}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative rounded-md px-1.5 py-1 text-sm font-medium transition-colors",
              "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity",
              isActive
                ? "text-foreground after:opacity-100"
                : "text-foreground/60 hover:text-foreground"
            )}
          >
            {t.inbox.tabs[tab]}
          </Link>
        )
      })}
    </nav>
  )
}
