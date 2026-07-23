import type { Metadata } from "next"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { PlanCards } from "@/features/marketing/ui/plan-cards"
import { ComparisonTable } from "@/features/marketing/ui/comparison-table"
import { FaqSection } from "@/features/marketing/ui/faq-section"
import { FinalCta } from "@/features/marketing/ui/final-cta"
import { dict } from "@/content/i18n/es"

export const metadata: Metadata = {
  title: "Precios — Resender",
  description:
    "Planes desde $15/mes. Compará Resender con ManyChat y elegí el plan que se ajuste a tu volumen de mensajes. Sin contratos.",
  openGraph: {
    title: "Precios — Resender",
    description:
      "Planes simples desde $15/mes. La alternativa developer-first a ManyChat.",
    type: "website",
  },
}

export default function PricingPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteBackground />
      <SiteHeader />
      <main className="flex-1">
        <Section>
          <SectionHeading
            kicker="pricing"
            title={dict.pricing.title}
            subtitle={dict.pricing.subtitle}
          />
          <div className="mt-16">
            <PlanCards />
          </div>
        </Section>

        <ComparisonTable />

        <FaqSection title={dict.pricingFaq.title} items={dict.pricingFaq.items} />

        <FinalCta
          title={dict.pricingCta.title}
          subtitle={dict.pricingCta.subtitle}
          cta={dict.pricingCta.cta}
        />
      </main>
      <SiteFooter />
    </div>
  )
}
