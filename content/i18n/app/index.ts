import type { Locale } from "@/content/i18n"

import type { AppDict } from "./dictionary"
import { es } from "./es"
import { en } from "./en"

export type { AppDict, ChannelMap, HistorySyncCopy } from "./dictionary"
export { fmt, plural } from "./format"

const dictionaries: Record<Locale, AppDict> = { es, en }

/** El diccionario del producto en un idioma ya resuelto. Módulo puro. */
export function getAppDictionary(locale: Locale): AppDict {
  return dictionaries[locale]
}
