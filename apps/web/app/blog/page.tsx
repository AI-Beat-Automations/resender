import type { Metadata } from "next"

import { BlogListView } from "@/features/marketing/views/blog-list-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, OG_LOCALES } from "@/lib/seo"

const dict = getDictionary("es")

export const metadata: Metadata = {
  title: dict.blog.metaTitle,
  description: dict.blog.metaDescription,
  alternates: alternatesFor("/blog", "es"),
  openGraph: {
    title: dict.blog.metaTitle,
    description: dict.blog.metaDescription,
    type: "website",
    locale: OG_LOCALES.es,
  },
}

export default function BlogPage() {
  return <BlogListView lang="es" />
}
