import type { Metadata } from "next"

import { BlogPostView } from "@/features/marketing/views/blog-post-view"
import { getPostBySlug, getPostSlugs, localesWithPost } from "@/lib/blog"
import { alternatesFor, openGraphFor } from "@/lib/seo"

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
    title: post.title,
    description: post.abstract,
    alternates: alternatesFor(`/blog/${slug}`, "en", localesWithPost(slug)),
    openGraph: openGraphFor({
      title: post.title,
      description: post.abstract,
      lang: "en",
      type: "article",
      image: `/en/blog/${slug}/opengraph-image`,
      publishedTime: post.publishedOn,
    }),
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
