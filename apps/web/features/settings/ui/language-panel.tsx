import type { AppDict } from "@/content/i18n/app"
import type { Locale } from "@/content/i18n"
import { setAppLocaleAction } from "@/features/settings/actions"
import { locales } from "@/content/i18n"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

// Selector de idioma de la consola, dibujado como fila de la tarjeta «Cuenta»
// (ADR 0015, mock 1j). Sigue siendo server component con una server action por
// botón: `ToggleGroup` es cliente de Radix, pero recibe como hijos botones DOM
// `type="submit" name="locale"` vía `asChild`, así que el `<form>` sigue
// escribiendo la cookie sin ningún `onChange` en el cliente. `value={lang}`
// solo pinta cuál está activo.
//
// Cada etiqueta va **en su propio idioma** —«Español», «English»— que es la
// convención de los selectores de idioma: quien busca el suyo lo reconoce sin
// saber leer el otro.
export function LanguagePanel({ lang, t }: { lang: Locale; t: AppDict }) {
  return (
    <form
      action={setAppLocaleAction}
      className="flex flex-col gap-1.5"
      aria-label={t.settings.language.label}
    >
      <ToggleGroup type="single" value={lang} variant="outline" size="sm">
        {locales.map((locale) => (
          <ToggleGroupItem key={locale} value={locale} asChild>
            <button type="submit" name="locale" value={locale}>
              {t.settings.language[locale]}
            </button>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-[12.5px] text-muted-foreground">
        {t.settings.language.body}
      </p>
    </form>
  )
}
