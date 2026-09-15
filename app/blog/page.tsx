import type { Metadata } from "next"

import { BlogListView } from "@/features/marketing/views/blog-list-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("es")

export const metadata: Metadata = {
  title: dict.blog.metaTitle,
  description: dict.blog.metaDescription,
  alternates: alternatesFor("/blog", "es"),
  openGraph: openGraphFor({
    title: dict.blog.metaTitle,
    description: dict.blog.metaDescription,
    lang: "es",
  }),
}

export default function BlogPage() {
  return <BlogListView lang="es" />
}
