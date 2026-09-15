import type { Metadata } from "next"

import { VsManychatView } from "@/features/marketing/views/vs-manychat-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("es")

export const metadata: Metadata = {
  title: { absolute: dict.vsManychat.metaTitle },
  description: dict.vsManychat.metaDescription,
  alternates: alternatesFor("/vs-manychat", "es"),
  openGraph: openGraphFor({
    title: dict.vsManychat.metaTitle,
    description: dict.vsManychat.metaDescription,
    lang: "es",
  }),
}

export default function VsManychatPage() {
  return <VsManychatView lang="es" />
}
