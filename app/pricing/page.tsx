import type { Metadata } from "next"

import { PricingView } from "@/features/marketing/views/pricing-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("es")

export const metadata: Metadata = {
  title: dict.meta.pricing.title,
  description: dict.meta.pricing.description,
  alternates: alternatesFor("/pricing", "es"),
  openGraph: openGraphFor({
    title: dict.meta.pricing.ogTitle,
    description: dict.meta.pricing.ogDescription,
    lang: "es",
  }),
}

export default function PricingPage() {
  return <PricingView lang="es" />
}
