import type { Metadata } from "next"

import { PricingView } from "@/features/marketing/views/pricing-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("en")

export const metadata: Metadata = {
  title: dict.meta.pricing.title,
  description: dict.meta.pricing.description,
  alternates: alternatesFor("/pricing", "en"),
  openGraph: openGraphFor({
    title: dict.meta.pricing.ogTitle,
    description: dict.meta.pricing.ogDescription,
    lang: "en",
  }),
}

export default function EnPricingPage() {
  return <PricingView lang="en" />
}
