import { Check } from "lucide-react"

import type { AppDict } from "@/content/i18n/app"
import type { Locale } from "@/content/i18n"
import { setAppLocaleAction } from "@/features/settings/actions"
import {
  SettingsCard,
  SettingsCardTitle,
} from "@/features/settings/ui/settings-card"
import { locales } from "@/content/i18n"
import { Button } from "@workspace/ui/components/button"

// Selector de idioma de la consola. Server component con una server action por
// botón: no hace falta cliente para escribir una cookie y revalidar.
//
// Dos botones y no un `<select>` porque son dos opciones y el `select` obligaría
// a un `onChange` en el cliente o a un botón de guardar extra. Cada etiqueta va
// **en su propio idioma** —«Español», «English»— que es la convención de los
// selectores de idioma: quien busca el suyo lo reconoce sin saber leer el otro.
export function LanguagePanel({ lang, t }: { lang: Locale; t: AppDict }) {
  return (
    <SettingsCard>
      <SettingsCardTitle>{t.settings.language.title}</SettingsCardTitle>
      <p className="mt-1 max-w-140 text-[13.5px]/[1.55] text-muted-foreground">
        {t.settings.language.body}
      </p>
      <form
        action={setAppLocaleAction}
        className="mt-4 flex flex-wrap gap-2.5"
        aria-label={t.settings.language.label}
      >
        {locales.map((locale) => {
          const active = locale === lang
          return (
            <Button
              key={locale}
              type="submit"
              name="locale"
              value={locale}
              size="lg"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
            >
              {active ? <Check className="size-3.5" aria-hidden /> : null}
              {t.settings.language[locale]}
            </Button>
          )
        })}
      </form>
    </SettingsCard>
  )
}
