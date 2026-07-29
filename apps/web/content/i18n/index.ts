import type { Dict, Locale } from "./dictionary"
import { es } from "./es"
import { en } from "./en"

export type {
  Dict,
  Locale,
  FaqItem,
  PainItem,
  Step,
  Plan,
  ComparisonRow,
} from "./dictionary"

export {
  locales,
  defaultLocale,
  localePath,
  localeFromPathname,
  switchLocalePath,
} from "./dictionary"

const dictionaries: Record<Locale, Dict> = { es, en }

export function getDictionary(locale: Locale): Dict {
  return dictionaries[locale]
}
