import type { Metadata } from "next"

import { BlogListView } from "@/features/marketing/views/blog-list-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("en")

export const metadata: Metadata = {
  title: dict.blog.metaTitle,
  description: dict.blog.metaDescription,
  alternates: alternatesFor("/blog", "en"),
  openGraph: openGraphFor({
    title: dict.blog.metaTitle,
    description: dict.blog.metaDescription,
    lang: "en",
  }),
}

export default function EnBlogPage() {
  return <BlogListView lang="en" />
}
