import type { Metadata } from "next"
import Link from "next/link"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@workspace/ui/components/card"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { getPublishedPosts, CATEGORY_LABELS, formatDate } from "@/lib/blog"

export const metadata: Metadata = {
  title: "Blog — Resender",
  description:
    "Tutoriales y actualizaciones sobre cómo integrar mensajes de Meta con Resender.",
}

export default function BlogPage() {
  const posts = getPublishedPosts("es")

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
            <div className="mx-auto mt-16 grid max-w-4xl gap-6 sm:grid-cols-2">
              {posts.map((post) => (
                <Link key={post.slug} href={`/blog/${post.slug}`} className="group">
                  <Card className="h-full transition-colors group-hover:ring-primary/40">
                    <CardHeader>
                      <Badge variant="secondary" className="w-fit">
                        {CATEGORY_LABELS[post.category]}
                      </Badge>
                      <CardTitle className="mt-2 transition-colors group-hover:text-primary">
                        {post.title}
                      </CardTitle>
                      <CardDescription>{post.abstract}</CardDescription>
                    </CardHeader>
                    <CardFooter className="text-sm text-muted-foreground">
                      <time dateTime={post.publishedOn}>
                        {formatDate(post.publishedOn)}
                      </time>
                    </CardFooter>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </Section>
      </main>
      <SiteFooter />
    </div>
  )
}
