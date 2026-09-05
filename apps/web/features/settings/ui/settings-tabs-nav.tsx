import Link from "next/link"

import type { AppDict } from "@/content/i18n/app"
import { SETTINGS_TABS, type SettingsTab } from "@/lib/settings/settings-tabs"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

// Pestañas de Ajustes sobre `Tabs` de shadcn (ADR 0015), pero el estado sigue
// en `?tab=` (ADR 0005): cada pestaña es un `Link` vía `asChild`, así que la
// navegación es recargable, compartible y con botón atrás, y la página sigue
// renderizando la pestaña en servidor. No hay `TabsContent`: `Tabs` solo pinta
// cuál está activa. El `?tab=` va siempre explícito —a diferencia de Inbox—
// porque la franja de cuota enlaza a `/settings?tab=suscripcion`.
export function SettingsTabsNav({
  active,
  t,
}: {
  active: SettingsTab
  t: AppDict
}) {
  return (
    <Tabs value={active}>
      <TabsList variant="line" aria-label={t.settings.tabsAria}>
        {SETTINGS_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab} asChild>
            <Link
              href={`/settings?tab=${tab}`}
              aria-current={tab === active ? "page" : undefined}
            >
              {t.settings.tabs[tab]}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
