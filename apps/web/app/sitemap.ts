import type { MetadataRoute } from "next"

import { getPublishedPosts, localesWithPost } from "@/lib/blog"
import { SITE_URL, absoluteUrl } from "@/lib/site-config"
import { locales, localePath, type Locale } from "@/content/i18n"

// Rutas de producto: existen en los dos idiomas (raíz = ES, /en = EN).
const LOCALIZED_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/vs-manychat", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/blog", priority: 0.7, changeFrequency: "weekly" as const },
]

// Rutas que existen en un solo idioma y NO se prefijan. `/docs` ya no está:
// vive en docs.resender.dev y acá solo queda un 301 (ver next.config.ts).
const SHARED_ROUTES = ["/privacy", "/terms", "/data-deletion"]

// Las páginas fijas no tienen fecha de contenido propia. Usar `new Date()` hacía
// que su `lastmod` cambiara en CADA deploy sin cambiar el contenido — ruido que
// enseña a Google a desconfiar de la señal. Se sube a mano cuando el copy cambia
// de verdad.
const STATIC_CONTENT_UPDATED_AT = new Date("2026-07-27")

function absolute(path: string, lang: Locale) {
  return absoluteUrl(localePath(path, lang))
}

// hreflang dentro del propio sitemap (`xhtml:link`). Next NO autorreferencia:
// el idioma de la <loc> tiene que estar explícito en `languages`.
function languagesFor(path: string, available: readonly Locale[]) {
  return Object.fromEntries(available.map((lang) => [lang, absolute(path, lang)]))
}

export default function sitemap(): MetadataRoute.Sitemap {
  const localizedRoutes = LOCALIZED_ROUTES.flatMap((route) =>
    locales.map((lang: Locale) => ({
      url: absolute(route.path, lang),
      lastModified: STATIC_CONTENT_UPDATED_AT,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: { languages: languagesFor(route.path, locales) },
    }))
  )

  const sharedRoutes = SHARED_ROUTES.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: STATIC_CONTENT_UPDATED_AT,
    changeFrequency: "yearly" as const,
    priority: 0.3,
  }))

  const postRoutes = locales.flatMap((lang: Locale) =>
    getPublishedPosts(lang).map((post) => {
      const date = new Date(post.updatedOn ?? post.publishedOn)
      const path = `/blog/${post.slug}`
      return {
        url: absolute(path, lang),
        lastModified: Number.isNaN(date.getTime())
          ? STATIC_CONTENT_UPDATED_AT
          : date,
        changeFrequency: "yearly" as const,
        priority: 0.8,
        // Solo los idiomas en los que ese post existe: un alternate a 404
        // invalida el clúster hreflang entero.
        alternates: {
          languages: languagesFor(path, localesWithPost(post.slug)),
        },
      }
    })
  )

  return [...localizedRoutes, ...sharedRoutes, ...postRoutes]
}
