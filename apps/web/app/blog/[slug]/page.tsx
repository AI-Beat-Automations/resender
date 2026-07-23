import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { compileMDX } from "next-mdx-remote/rsc"
import remarkGfm from "remark-gfm"
import rehypePrettyCode from "rehype-pretty-code"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import {
  getPostBySlug,
  getPostSlugs,
  CATEGORY_LABELS,
  formatDate,
} from "@/lib/blog"

const prettyCodeOptions = {
  // Temas duales: los tokens usan CSS vars que alternan con la clase .dark
  // (ver el snippet .shiki en packages/ui/src/styles/globals.css).
  theme: { light: "github-light", dark: "github-dark" },
  keepBackground: false,
}

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getPostBySlug(slug)
  if (!post) return {}
  return {
    title: `${post.title} — Resender`,
    description: post.abstract,
    openGraph: {
      title: post.title,
      description: post.abstract,
      type: "article",
      publishedTime: post.publishedOn,
    },
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = getPostBySlug(slug)
  if (!post) notFound()

  const { content } = await compileMDX({
    source: post.content,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [[rehypePrettyCode, prettyCodeOptions]],
      },
    },
  })

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 md:py-16">
        <Link
          href="/blog"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Volver al blog
        </Link>

        <header className="mt-8">
          <Badge variant="secondary">{CATEGORY_LABELS[post.category]}</Badge>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">{post.title}</h1>
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{post.author}</span>
            <span>·</span>
            <time dateTime={post.publishedOn}>{formatDate(post.publishedOn)}</time>
          </div>
        </header>

        <article className="prose prose-neutral mt-10 max-w-none dark:prose-invert prose-headings:tracking-tight prose-pre:border prose-pre:border-border prose-pre:bg-muted">
          {content}
        </article>

        <div className="mt-16 rounded-2xl border border-border bg-muted/40 p-8 text-center">
          <h2 className="text-xl font-semibold">¿Listo para empezar?</h2>
          <p className="mt-2 text-muted-foreground">
            Conectá tu primera página y recibí mensajes en minutos.
          </p>
          <Button asChild className="mt-4">
            <Link href="/register">Empezá gratis</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
