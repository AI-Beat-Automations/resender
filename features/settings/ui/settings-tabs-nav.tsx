import Link from "next/link"

import type { AppDict } from "@/content/i18n/app"
import type { SettingsTab } from "@/lib/settings/settings-tabs"
import { cn } from "@/lib/utils"

// Pestañas de Ajustes como enlaces, no como `Tabs` de Radix (ADR 0005): el
// estado vive en `?tab=`, así que la navegación tiene que ser recargable,
// compartible y con botón atrás. Se copia el aspecto de `TabsList
// variant="line"` (subrayado bajo la pestaña activa) sin su comportamiento
// cliente, y así la pantalla entera sigue siendo server component.
export function SettingsTabsNav({
  tabs,
  active,
  t,
}: {
  /** Las pestañas de este actor (`settingsTabsFor`): un cliente solo tiene Cuenta. */
  tabs: readonly SettingsTab[]
  active: SettingsTab
  t: AppDict
}) {
  return (
    <nav aria-label={t.settings.tabsAria} className="mt-4.5 flex gap-1">
      {tabs.map((tab) => {
        const isActive = tab === active

        return (
          <Link
            key={tab}
            href={`/settings?tab=${tab}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative rounded-md px-1.5 py-1 text-sm font-medium transition-colors",
              "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity",
              isActive
                ? "text-foreground after:opacity-100"
                : "text-foreground/60 hover:text-foreground"
            )}
          >
            {t.settings.tabs[tab]}
          </Link>
        )
      })}
    </nav>
  )
}
