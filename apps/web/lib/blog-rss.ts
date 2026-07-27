import "server-only"

import { getPublishedPosts } from "@/lib/blog"
import { SITE_URL as BASE_URL } from "@/lib/site-config"
import { getDictionary, localePath, type Locale } from "@/content/i18n"

// Builder del feed RSS del blog, parametrizado por idioma: `/blog/rss.xml` (ES)
// y `/en/blog/rss.xml` (EN) comparten esta implementación.

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

// Omite <pubDate> si la fecha es inválida o falta (evita "Invalid Date").
function pubDate(iso: string): string {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) return ""
  return `\n      <pubDate>${date.toUTCString()}</pubDate>`
}

export function buildBlogRss(lang: Locale): string {
  const dict = getDictionary(lang)
  const blogPath = `${BASE_URL}${localePath("/blog", lang)}`
  const posts = getPublishedPosts(lang)

  const items = posts
    .map(
      (post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${blogPath}/${post.slug}</link>
      <guid>${blogPath}/${post.slug}</guid>
      <description>${escapeXml(post.abstract)}</description>${
        pubDate(post.publishedOn)
      }
    </item>`
    )
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(dict.blog.rssTitle)}</title>
    <link>${blogPath}</link>
    <description>${escapeXml(dict.blog.rssDescription)}</description>
    <language>${lang}</language>
${items}
  </channel>
</rss>`
}

export function blogRssResponse(lang: Locale): Response {
  return new Response(buildBlogRss(lang), {
    headers: { "Content-Type": "application/xml" },
  })
}
