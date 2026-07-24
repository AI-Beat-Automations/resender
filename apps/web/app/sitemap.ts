import type { MetadataRoute } from "next"

import { getPublishedPosts } from "@/lib/blog"

const BASE_URL = "https://resender.dev"

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "",
    "/pricing",
    "/blog",
    "/docs",
    "/privacy",
    "/terms",
    "/data-deletion",
  ].map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
  }))

  const postRoutes = getPublishedPosts("es").map((post) => {
    const date = new Date(post.updatedOn ?? post.publishedOn)
    return {
      url: `${BASE_URL}/blog/${post.slug}`,
      lastModified: Number.isNaN(date.getTime()) ? new Date() : date,
    }
  })

  return [...staticRoutes, ...postRoutes]
}
