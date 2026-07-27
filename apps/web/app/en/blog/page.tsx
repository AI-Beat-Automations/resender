import type { Metadata } from "next"

import { BlogListView } from "@/features/marketing/views/blog-list-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, OG_LOCALES } from "@/lib/seo"

const dict = getDictionary("en")

export const metadata: Metadata = {
  title: dict.blog.metaTitle,
  description: dict.blog.metaDescription,
  alternates: alternatesFor("/blog", "en"),
  openGraph: {
    title: dict.blog.metaTitle,
    description: dict.blog.metaDescription,
    type: "website",
    locale: OG_LOCALES.en,
  },
}

export default function EnBlogPage() {
  return <BlogListView lang="en" />
}
