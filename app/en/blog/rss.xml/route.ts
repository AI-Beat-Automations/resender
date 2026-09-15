import { blogRssResponse } from "@/lib/blog-rss"

// Prerenderizado en build: el worker no tiene los .md en su filesystem, así
// que en runtime el feed saldría vacío.
export const dynamic = "force-static"

export function GET() {
  return blogRssResponse("en")
}
