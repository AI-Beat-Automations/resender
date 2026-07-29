"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Switch } from "@workspace/ui/components/switch"

// Switch sol/luna para alternar claro/oscuro. next-themes ya está cableado
// (attribute="class" + persistencia en localStorage). Ver también el hotkey "d"
// en components/theme-provider.tsx.
//
// ALCANCE: solo la consola (features/shell/ui/app-sidebar.tsx). El sitio público
// terminó su evaluación interna y quedó en modo claro fijo, así que salió de la
// navbar; cada vista de marketing se envuelve en `.light` y no responde a este
// switch ni al hotkey. No borrar este componente: la consola sí lo usa.
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
