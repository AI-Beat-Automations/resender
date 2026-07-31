import type { MetadataRoute } from "next"

import { getPublishedPosts, localesWithPost } from "@/lib/blog"
import {
  SITE_URL,
  STATIC_CONTENT_UPDATED_AT,
  absoluteUrl,
} from "@/lib/site-config"
import { locales, localePath, type Locale } from "@/content/i18n"

// Rutas de producto: existen en los dos idiomas (raíz = ES, /en = EN).
const LOCALIZED_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/vs-manychat", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/blog", priority: 0.7, changeFrequency: "weekly" as const },
]

// Rutas que existen en un solo idioma y NO se prefijan. `/docs` ya no está:
// redirige a la referencia API externa (ver next.config.ts).
const SHARED_ROUTES = ["/privacy", "/terms", "/data-deletion"]

// Fecha de la última vez que cambió el copy de las páginas fijas. Vive en
// `lib/site-config.ts` porque /llms-full.txt declara la misma.
const staticUpdatedAt = new Date(STATIC_CONTENT_UPDATED_AT)

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
      lastModified: staticUpdatedAt,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: { languages: languagesFor(route.path, locales) },
    }))
  )

  const sharedRoutes = SHARED_ROUTES.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: staticUpdatedAt,
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
          ? staticUpdatedAt
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
