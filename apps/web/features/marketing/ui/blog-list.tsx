"use client"

import { useState } from "react"
import Link from "next/link"

import { getDictionary, localePath, type Locale } from "@/content/i18n"

// Entrada serializable que pasa el server component (la vista del listado). La
// fecha ya viene formateada porque lib/blog es "server-only".
export type BlogListItem = {
  slug: string
  title: string
  abstract: string
  category?: "tutorial" | "actualizacion"
  publishedOn: string
  dateLabel: string
}

type Category = "tutorial" | "actualizacion"

export function BlogList({
  lang,
  posts,
}: {
  lang: Locale
  posts: BlogListItem[]
}) {
  const [active, setActive] = useState<Category | null>(null)
  const dict = getDictionary(lang)

  const filters: { value: Category; label: string }[] = [
    { value: "tutorial", label: dict.blog.filters.tutorial },
    { value: "actualizacion", label: dict.blog.filters.actualizacion },
  ]

  const visible = active ? posts.filter((p) => p.category === active) : posts

  return (
    <div className="mx-auto mt-12 max-w-3xl">
      {/* Filtro: dos opciones lado a lado. Click de nuevo en la activa = ver todo. */}
      <div
        className="flex gap-2"
        role="group"
        aria-label={dict.blog.filterGroupLabel}
      >
        {filters.map((f) => {
          const isActive = active === f.value
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActive(isActive ? null : f.value)}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <p className="mt-12 text-muted-foreground">{dict.blog.emptyCategory}</p>
      ) : (
        <ul className="mt-10 divide-y divide-border">
          {visible.map((post) => (
            <li key={post.slug}>
              <Link
                href={localePath(`/blog/${post.slug}`, lang)}
                className="group block py-6"
              >
                {post.publishedOn && (
                  <time
                    dateTime={post.publishedOn}
                    className="text-xs text-muted-foreground"
                  >
                    {post.dateLabel}
                  </time>
                )}
                <h2 className="mt-1 text-xl font-semibold tracking-tight transition-colors group-hover:text-primary">
                  {post.title}
                </h2>
                {post.abstract && (
                  <p className="mt-1 line-clamp-1 text-muted-foreground">
                    {post.abstract}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
