import type { Metadata } from "next"

import { PricingView } from "@/features/marketing/views/pricing-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, OG_LOCALES } from "@/lib/seo"

const dict = getDictionary("en")

export const metadata: Metadata = {
  title: dict.meta.pricing.title,
  description: dict.meta.pricing.description,
  alternates: alternatesFor("/pricing", "en"),
  openGraph: {
    title: dict.meta.pricing.ogTitle,
    description: dict.meta.pricing.ogDescription,
    type: "website",
    locale: OG_LOCALES.en,
  },
}

export default function EnPricingPage() {
  return <PricingView lang="en" />
}
