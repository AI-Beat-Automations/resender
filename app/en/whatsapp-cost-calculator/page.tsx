import type { Metadata } from "next"

import { WhatsappCostView } from "@/features/marketing/views/whatsapp-cost-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("en")

export const metadata: Metadata = {
  title: { absolute: dict.whatsappCost.metaTitle },
  description: dict.whatsappCost.metaDescription,
  alternates: alternatesFor("/whatsapp-cost-calculator", "en"),
  openGraph: openGraphFor({
    title: dict.whatsappCost.metaTitle,
    description: dict.whatsappCost.metaDescription,
    lang: "en",
  }),
}

export default function EnWhatsappCostPage() {
  return <WhatsappCostView lang="en" />
}
