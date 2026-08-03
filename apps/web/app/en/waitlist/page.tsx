import type { Metadata } from "next"

import { WaitlistView } from "@/features/marketing/views/waitlist-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("en")

export const metadata: Metadata = {
  title: dict.meta.waitlist.title,
  description: dict.meta.waitlist.description,
  alternates: alternatesFor("/waitlist", "en"),
  openGraph: openGraphFor({
    title: dict.meta.waitlist.ogTitle,
    description: dict.meta.waitlist.ogDescription,
    lang: "en",
  }),
}

export default function EnWaitlistPage() {
  return <WaitlistView lang="en" />
}
