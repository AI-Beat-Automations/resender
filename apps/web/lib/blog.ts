import "server-only"

import fs from "node:fs"
import path from "node:path"

import matter from "gray-matter"

// Loader del blog. Módulo NUEVO (no toca la lógica de dominio en lib/).
// Los posts se escriben como .mdx en content/blog con frontmatter (ver
// resender-website-spec.md §3.3) y se renderizan en build time (SSG).

export type BlogCategory = "tutorial" | "actualizacion"

export type BlogFrontmatter = {
  title: string
  abstract: string
  category: BlogCategory
  isPublished: boolean
  publishedOn: string
  updatedOn?: string
  author: string
  lang: string
}

export type BlogPost = BlogFrontmatter & {
  slug: string
  content: string
}

const BLOG_DIR = path.join(process.cwd(), "content", "blog")

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

function readPost(fileName: string): BlogPost | null {
  const slug = fileName.replace(/\.mdx?$/, "")
  const raw = fs.readFileSync(path.join(BLOG_DIR, fileName), "utf-8")
  const { data, content } = matter(raw)

  if (!data.title) return null

  return {
    slug,
    title: String(data.title),
    abstract: String(data.abstract ?? ""),
    category: (data.category as BlogCategory) ?? "tutorial",
    isPublished: data.isPublished !== false,
    publishedOn: normalizeDate(data.publishedOn),
    updatedOn: data.updatedOn ? normalizeDate(data.updatedOn) : undefined,
    author: String(data.author ?? ""),
    lang: String(data.lang ?? "es"),
    content,
  }
}

function readAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return []
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => /\.mdx?$/.test(f))
    .map(readPost)
    .filter((p): p is BlogPost => p !== null)
}

// Listado publicado, filtrado por idioma y ordenado por fecha (desc).
export function getPublishedPosts(lang = "es"): BlogPost[] {
  return readAllPosts()
    .filter((p) => p.isPublished && p.lang === lang)
    .sort((a, b) => (a.publishedOn < b.publishedOn ? 1 : -1))
}

export function getPostSlugs(): string[] {
  return readAllPosts()
    .filter((p) => p.isPublished)
    .map((p) => p.slug)
}

export function getPostBySlug(slug: string): BlogPost | null {
  const post = readAllPosts().find((p) => p.slug === slug)
  return post && post.isPublished ? post : null
}

export const CATEGORY_LABELS: Record<BlogCategory, string> = {
  tutorial: "Tutorial",
  actualizacion: "Actualización",
}

export function formatDate(iso: string, lang = "es"): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(lang === "es" ? "es-AR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}
