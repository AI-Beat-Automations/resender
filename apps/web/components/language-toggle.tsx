"use client"

import { usePathname, useRouter } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"
import { Switch } from "@workspace/ui/components/switch"

import {
  localeFromPathname,
  switchLocalePath,
  type Locale,
} from "@/content/i18n"
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/locale-cookie"

// Switch ES/EN, hermano del ThemeToggle (mismo look: dos labels flanqueando un
// Switch). Deriva el idioma del pathname en vez de recibirlo por prop para poder
// vivir dentro del header cliente, y navega a la ruta equivalente.
//
// Además **deja escrita la preferencia en una cookie**. En el sitio público el
// idioma ES el path, así que la cookie no cambia nada acá; existe para el otro
// lado de la puerta: las pantallas de producto llevan `noindex` y no tienen
// gemela en `/en`, así que su idioma sale de la cookie. Sin esto, quien lee el
// landing en inglés y se registra desde `/en/register` aterriza en un dashboard
// en español.
export function LanguageToggle() {
  const pathname = usePathname()
  const router = useRouter()
  const isEn = localeFromPathname(pathname) === "en"

  const remember = (locale: Locale) => {
    // Sin `httpOnly` a propósito: la escribe este componente cliente y la lee el
    // servidor, así que es una preferencia compartida y no un secreto.
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`
  }

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
        onCheckedChange={(checked) => {
          const locale: Locale = checked ? "en" : "es"
          remember(locale)
          router.push(switchLocalePath(pathname, locale))
        }}
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
