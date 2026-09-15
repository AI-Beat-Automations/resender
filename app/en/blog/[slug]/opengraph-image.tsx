import { ImageResponse } from "next/og"

import { OgCard, OG_CONTENT_TYPE, OG_SIZE, ogFonts } from "@/lib/og"
import { getPostBySlug, getPostSlugs } from "@/lib/blog"
import { getDictionary } from "@/content/i18n"

export const alt = "Resender"
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export function generateStaticParams() {
  return getPostSlugs("en").map((slug) => ({ slug }))
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const dict = getDictionary("en")
  const post = getPostBySlug(slug, "en")

  return new ImageResponse(
    (
      <OgCard
        kicker={dict.blog.title}
        title={post?.title ?? dict.blog.title}
        subtitle={post?.abstract}
      />
    ),
    { ...size, fonts: ogFonts() }
  )
}
