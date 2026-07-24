import type { Metadata } from "next"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { getPublishedPosts, formatDate } from "@/lib/blog"
import { BlogList, type BlogListItem } from "./blog-list"

export const metadata: Metadata = {
  title: "Blog — Resender",
  description:
    "Tutoriales y actualizaciones sobre cómo integrar mensajes de Meta con Resender.",
}

export default function BlogPage() {
  const posts: BlogListItem[] = getPublishedPosts("es").map((post) => ({
    slug: post.slug,
    title: post.title,
    abstract: post.abstract,
    category: post.category,
    publishedOn: post.publishedOn,
    dateLabel: post.publishedOn ? formatDate(post.publishedOn) : "",
  }))

  return (
    <div className="flex min-h-svh flex-col">
      <SiteBackground />
      <SiteHeader />
      <main className="flex-1">
        <Section>
          <SectionHeading
            title="Blog"
            subtitle="Tutoriales y novedades del producto."
          />

          {posts.length === 0 ? (
            <p className="mt-12 text-center text-muted-foreground">
              Todavía no hay posts publicados.
            </p>
          ) : (
            <BlogList posts={posts} />
          )}
        </Section>
      </main>
      <SiteFooter />
    </div>
  )
}
