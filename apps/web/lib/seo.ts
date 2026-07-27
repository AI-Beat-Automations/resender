import { localePath, type Locale } from "@/content/i18n"

// Helpers de SEO por idioma. El sitio sirve el español en la raíz y el inglés
// bajo /en, así que cada página localizada declara su canonical + los hreflang
// de su gemela. `x-default` apunta siempre al español (idioma por defecto).

export const OG_LOCALES: Record<Locale, string> = {
  es: "es_AR",
  en: "en_US",
}

// `path` es la ruta SIN prefijo de idioma ("/", "/pricing", "/blog/mi-post").
export function alternatesFor(path: string, lang: Locale) {
  const es = localePath(path, "es")
  const en = localePath(path, "en")
  return {
    canonical: localePath(path, lang),
    languages: { es, en, "x-default": es },
  }
}
