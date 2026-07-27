import type { Metadata } from "next"

import { localePath, locales, type Locale } from "@/content/i18n"

// Helpers de SEO por idioma. El sitio sirve el español en la raíz y el inglés
// bajo /en, así que cada página localizada declara su canonical + los hreflang
// de su gemela. `x-default` apunta siempre al español (idioma por defecto).

export const OG_LOCALES: Record<Locale, string> = {
  es: "es_AR",
  en: "en_US",
}

/**
 * Canonical + hreflang de una ruta localizada.
 *
 * `path` va SIN prefijo de idioma ("/", "/pricing", "/blog/mi-post").
 *
 * `available` acota los idiomas en los que la página existe de verdad. Importa
 * en el blog: si un post está solo en español y declaramos igual el hreflang
 * inglés, ese `<link>` apunta a un 404 y Google descarta el clúster hreflang
 * ENTERO — la página ES pierde también su propia anotación. Por defecto asume
 * los dos idiomas, que es el caso de las páginas fijas.
 */
export function alternatesFor(
  path: string,
  lang: Locale,
  available: readonly Locale[] = locales
) {
  const languages: Record<string, string> = {}
  for (const locale of locales) {
    if (available.includes(locale)) languages[locale] = localePath(path, locale)
  }

  // x-default = español si existe; si no, el primer idioma disponible.
  const fallback = available.includes("es") ? "es" : available[0]
  if (fallback) languages["x-default"] = localePath(path, fallback)

  return { canonical: localePath(path, lang), languages }
}

/**
 * Bloque `openGraph` de una página de marketing.
 *
 * Existe porque `openGraph` NO se fusiona con el del layout padre: la página que
 * declara el suyo lo reemplaza entero, y con él se va la imagen que inyecta la
 * convención de archivos `opengraph-image.tsx`. Por eso hay que declarar
 * `images` acá explícitamente — si no, /pricing, /blog y /vs-manychat se
 * comparten sin tarjeta mientras la home sí la tiene.
 *
 * `image` por defecto es la tarjeta del idioma (`app/opengraph-image.png` y su
 * gemela bajo `/en`): un screenshot real del hero de la landing, con el
 * typewriter y el FlowMock ya terminados. Los posts pasan la suya, que sí se
 * genera al vuelo con el título del artículo.
 */
export function openGraphFor({
  title,
  description,
  lang,
  type = "website",
  image,
  publishedTime,
}: {
  title: string
  description: string
  lang: Locale
  type?: "website" | "article"
  image?: string
  publishedTime?: string
}) {
  return {
    title,
    description,
    type,
    locale: OG_LOCALES[lang],
    images: [image ?? localePath("/opengraph-image.png", lang)],
    ...(publishedTime ? { publishedTime } : {}),
  }
}

/**
 * Metadata de páginas sin valor de búsqueda (auth, checkout, waitlist, app
 * logueada). El `title` evita que se sirvan sin `<title>` y el `noindex` las
 * saca del índice — el Disallow de robots.txt por sí solo no lo hace: impide
 * rastrear, no desindexar.
 */
export function privatePageMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
  }
}
