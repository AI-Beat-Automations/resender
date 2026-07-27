import type { Metadata } from "next"

import { BlogPostView } from "@/features/marketing/views/blog-post-view"
import { getPostBySlug, getPostSlugs } from "@/lib/blog"
import { alternatesFor, OG_LOCALES } from "@/lib/seo"

export function generateStaticParams() {
  return getPostSlugs("en").map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getPostBySlug(slug, "en")
  if (!post) return {}
  return {
    title: `${post.title} — Resender`,
    description: post.abstract,
    alternates: alternatesFor(`/blog/${slug}`, "en"),
    openGraph: {
      title: post.title,
      description: post.abstract,
      type: "article",
      locale: OG_LOCALES.en,
      publishedTime: post.publishedOn,
    },
  }
}

export default async function EnBlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <BlogPostView lang="en" slug={slug} />
}
