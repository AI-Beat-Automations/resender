"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Switch } from "@workspace/ui/components/switch"

// Switch sol/luna para alternar claro/oscuro. next-themes ya está cableado
// (attribute="class" + persistencia en localStorage). Ver también el hotkey "d"
// en components/theme-provider.tsx.
//
// NOTA: este switch es temporal, para evaluación interna entre los founders.
// Una vez elegido el modo definitivo, se remueve (ver resender-website-spec.md §4).
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  // Evita mismatch de hidratación: el tema real solo se conoce en el cliente.
  // Patrón idiomático de next-themes; el setState de un solo disparo es intencional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setMounted(true), [])

  const isDark = mounted && resolvedTheme === "dark"

  return (
    <label className="flex items-center gap-2" title="Cambiar tema">
      <Sun className="size-4 text-muted-foreground" aria-hidden />
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-label="Cambiar entre modo claro y oscuro"
      />
      <Moon className="size-4 text-muted-foreground" aria-hidden />
    </label>
  )
}
