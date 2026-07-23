import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { compileMDX } from "next-mdx-remote/rsc"
import remarkGfm from "remark-gfm"
import rehypePrettyCode from "rehype-pretty-code"
import rehypeSlug from "rehype-slug"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import {
  getPostBySlug,
  getPostSlugs,
  getHeadings,
  CATEGORY_LABELS,
  formatDate,
} from "@/lib/blog"

const prettyCodeOptions = {
  // Temas duales: los tokens usan CSS vars que alternan con la clase .dark
  // (ver el snippet .shiki en packages/ui/src/styles/globals.css).
  theme: { light: "github-light", dark: "github-dark" },
  keepBackground: false,
  // Los bloques sin lenguaje (``` a secas) igual se resaltan como texto plano,
  // así reciben el color del tema y no quedan invisibles sobre el fondo claro.
  defaultLang: "plaintext",
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

  const headings = getHeadings(post.content)

  const { content } = await compileMDX({
    source: post.content,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeSlug, [rehypePrettyCode, prettyCodeOptions]],
      },
    },
  })

  return (
    <div className="flex min-h-svh flex-col">
      <SiteBackground />
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 md:py-16">
        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
          <aside className="mb-10 lg:mb-0 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100svh-8rem)] lg:overflow-auto">
            <Link
              href="/blog"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Volver
            </Link>

            {headings.length >= 2 && (
              <nav aria-label="Tabla de contenidos" className="mt-8">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  En este artículo
                </p>
                <ul className="mt-3 space-y-2 border-l border-border text-sm">
                  {headings.map((h) => (
                    <li key={h.id}>
                      <a
                        href={`#${h.id}`}
                        className={`-ml-px block border-l border-transparent text-muted-foreground transition-colors hover:border-foreground hover:text-foreground ${
                          h.depth === 3 ? "pl-7" : "pl-4"
                        }`}
                      >
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </aside>

          <div className="min-w-0">
            <header>
              {post.category && (
                <Badge variant="secondary">
                  {CATEGORY_LABELS[post.category]}
                </Badge>
              )}
              <h1 className="mt-4 text-4xl font-bold tracking-tight">
                {post.title}
              </h1>
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                {post.author && (
                  <>
                    <span>{post.author}</span>
                    <span>·</span>
                  </>
                )}
                {post.publishedOn && (
                  <time dateTime={post.publishedOn}>
                    {formatDate(post.publishedOn)}
                  </time>
                )}
              </div>
            </header>

            <article className="prose prose-neutral mt-10 max-w-none dark:prose-invert prose-headings:tracking-tight prose-headings:scroll-mt-24 prose-pre:border prose-pre:border-border prose-pre:bg-muted">
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
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
