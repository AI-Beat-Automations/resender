import type { MetadataRoute } from "next"

import { getPublishedPosts } from "@/lib/blog"
import { locales, localePath, type Locale } from "@/content/i18n"

const BASE_URL = "https://resender.dev"

// Rutas de producto: existen en los dos idiomas (raíz = ES, /en = EN).
const LOCALIZED_ROUTES = ["", "/pricing", "/blog"]

// Rutas que existen en un solo idioma y NO se prefijan.
const SHARED_ROUTES = ["/docs", "/privacy", "/terms", "/data-deletion"]

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const localizedRoutes = locales.flatMap((lang: Locale) =>
    LOCALIZED_ROUTES.map((route) => ({
      url: `${BASE_URL}${localePath(route === "" ? "/" : route, lang)}`,
      lastModified: now,
    }))
  )

  const sharedRoutes = SHARED_ROUTES.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: now,
  }))

  const postRoutes = locales.flatMap((lang: Locale) =>
    getPublishedPosts(lang).map((post) => {
      const date = new Date(post.updatedOn ?? post.publishedOn)
      return {
        url: `${BASE_URL}${localePath(`/blog/${post.slug}`, lang)}`,
        lastModified: Number.isNaN(date.getTime()) ? now : date,
      }
    })
  )

  return [...localizedRoutes, ...sharedRoutes, ...postRoutes]
}
