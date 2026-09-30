import type { Metadata } from "next"

import { WhatsappCostView } from "@/features/marketing/views/whatsapp-cost-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("es")

export const metadata: Metadata = {
  title: { absolute: dict.whatsappCost.metaTitle },
  description: dict.whatsappCost.metaDescription,
  alternates: alternatesFor("/whatsapp-cost-calculator", "es"),
  openGraph: openGraphFor({
    title: dict.whatsappCost.metaTitle,
    description: dict.whatsappCost.metaDescription,
    lang: "es",
  }),
}

export default function WhatsappCostPage() {
  return <WhatsappCostView lang="es" />
}
