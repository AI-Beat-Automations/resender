import type { Metadata } from "next"

import { LandingView } from "@/features/marketing/views/landing-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("es")

export const metadata: Metadata = {
  title: { absolute: dict.meta.home.title },
  description: dict.meta.home.description,
  alternates: alternatesFor("/", "es"),
  openGraph: openGraphFor({
    title: dict.meta.home.ogTitle,
    description: dict.meta.home.ogDescription,
    lang: "es",
  }),
}

export default function HomePage() {
  return <LandingView lang="es" />
}
