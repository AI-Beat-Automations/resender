"use client"

import { usePathname, useRouter } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"
import { Switch } from "@workspace/ui/components/switch"

import { localeFromPathname, switchLocalePath } from "@/content/i18n"

// Switch ES/EN, hermano del ThemeToggle (mismo look: dos labels flanqueando un
// Switch). Deriva el idioma del pathname en vez de recibirlo por prop para poder
// vivir dentro del header cliente, y navega a la ruta equivalente.
export function LanguageToggle() {
  const pathname = usePathname()
  const router = useRouter()
  const isEn = localeFromPathname(pathname) === "en"

  return (
    <label className="flex items-center gap-2" title="Language · Idioma">
      <span
        className={cn(
          "font-mono text-xs",
          isEn ? "text-muted-foreground" : "text-foreground"
        )}
        aria-hidden
      >
        ES
      </span>
      <Switch
        checked={isEn}
        onCheckedChange={(checked) =>
          router.push(switchLocalePath(pathname, checked ? "en" : "es"))
        }
        aria-label="Switch language / Cambiar idioma"
      />
      <span
        className={cn(
          "font-mono text-xs",
          isEn ? "text-foreground" : "text-muted-foreground"
        )}
        aria-hidden
      >
        EN
      </span>
    </label>
  )
}
