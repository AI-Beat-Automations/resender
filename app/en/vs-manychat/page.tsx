import type { Metadata } from "next"

import { VsManychatView } from "@/features/marketing/views/vs-manychat-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("en")

export const metadata: Metadata = {
  title: { absolute: dict.vsManychat.metaTitle },
  description: dict.vsManychat.metaDescription,
  alternates: alternatesFor("/vs-manychat", "en"),
  openGraph: openGraphFor({
    title: dict.vsManychat.metaTitle,
    description: dict.vsManychat.metaDescription,
    lang: "en",
  }),
}

export default function EnVsManychatPage() {
  return <VsManychatView lang="en" />
}
