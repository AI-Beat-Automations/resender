import { getPublishedPosts } from "@/lib/blog"

const BASE_URL = "https://resender.dev"

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

// RSS feed del blog (SEO, opcional pero recomendado en el spec §5).
export function GET() {
  const posts = getPublishedPosts("es")

  const items = posts
    .map(
      (post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${BASE_URL}/blog/${post.slug}</link>
      <guid>${BASE_URL}/blog/${post.slug}</guid>
      <description>${escapeXml(post.abstract)}</description>${
        pubDate(post.publishedOn)
      }
    </item>`
    )
    .join("\n")

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Resender Blog</title>
    <link>${BASE_URL}/blog</link>
    <description>Tutoriales y actualizaciones de Resender.</description>
    <language>es</language>
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: { "Content-Type": "application/xml" },
  })
}
