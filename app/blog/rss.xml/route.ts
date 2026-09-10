import { blogRssResponse } from "@/lib/blog-rss"

// Prerenderizado en build: el worker no tiene los .md en su filesystem, así
// que en runtime el feed saldría vacío.
export const dynamic = "force-static"

// RSS feed del blog en español (SEO, opcional pero recomendado en el spec §5).
// El feed en inglés vive en /en/blog/rss.xml.
export function GET() {
  return blogRssResponse("es")
}
