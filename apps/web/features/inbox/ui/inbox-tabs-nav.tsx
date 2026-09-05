import Link from "next/link"

import type { AppDict } from "@/content/i18n/app"
import { INBOX_TABS, inboxHref, type InboxTab } from "@/lib/inbox/inbox-tabs"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

// Modo de Inbox sobre `Tabs` de shadcn (ADR 0015), pero el estado sigue en
// `?tab=` (ADR 0005): cada pestaña es un `Link` vía `asChild`, así que la
// navegación es recargable, compartible y con botón atrás, y la página entera
// sigue renderizando el modo en servidor. No hay `TabsContent`: `Tabs` solo
// pinta cuál está activa. Mismo patrón que `SettingsTabsNav`.
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
    <Tabs value={active}>
      <TabsList variant="line" aria-label={t.inbox.tabsAria}>
        {INBOX_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab} asChild>
            <Link
              href={inboxHref({ tab, pageId: accountId })}
              aria-current={tab === active ? "page" : undefined}
            >
              {t.inbox.tabs[tab]}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
