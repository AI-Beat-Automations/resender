import type { Metadata } from "next"

import { BlogPostView } from "@/features/marketing/views/blog-post-view"
import { getPostBySlug, getPostSlugs, localesWithPost } from "@/lib/blog"
import { alternatesFor, openGraphFor } from "@/lib/seo"

export function generateStaticParams() {
  return getPostSlugs("es").map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getPostBySlug(slug, "es")
  if (!post) return {}
  return {
    title: post.title,
    description: post.abstract,
    alternates: alternatesFor(`/blog/${slug}`, "es", localesWithPost(slug)),
    openGraph: openGraphFor({
      title: post.title,
      description: post.abstract,
      lang: "es",
      type: "article",
      image: `/blog/${slug}/opengraph-image`,
      publishedTime: post.publishedOn,
    }),
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <BlogPostView lang="es" slug={slug} />
}
