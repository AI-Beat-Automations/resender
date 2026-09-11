import { getAppDictionary, type AppDict } from "@/content/i18n/app"
import type { Locale } from "@/content/i18n"

import { resolveAppLocale } from "./app-locale"

/**
 * El idioma y el diccionario del producto para esta petición. Es lo que llaman
 * las pantallas del dashboard y las server actions: la cookie se lee una vez y
 * el resto del árbol recibe el `AppDict` ya resuelto.
 */
export async function getAppI18n(): Promise<{ lang: Locale; t: AppDict }> {
  const lang = await resolveAppLocale()
  return { lang, t: getAppDictionary(lang) }
}

/** Azúcar para quien solo necesita el diccionario (la mayoría). */
export async function getAppDict(): Promise<AppDict> {
  return (await getAppI18n()).t
}
