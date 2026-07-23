import type { Metadata } from "next"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { Hero } from "@/features/marketing/ui/hero"
import { PainPoint } from "@/features/marketing/ui/pain-point"
import { HowItWorks } from "@/features/marketing/ui/how-it-works"
import { Quickstart } from "@/features/marketing/ui/quickstart"
import { FeaturesGrid } from "@/features/marketing/ui/features-grid"
import { PricingPreview } from "@/features/marketing/ui/pricing-preview"
import { About } from "@/features/marketing/ui/about"
import { FaqSection } from "@/features/marketing/ui/faq-section"
import { FinalCta } from "@/features/marketing/ui/final-cta"
import { dict } from "@/content/i18n/es"

export const metadata: Metadata = {
  title: "Resender — La API relay para mensajes de Meta",
  description:
    "La alternativa developer-first a ManyChat. Recibí mensajes de Facebook en tu webhook y respondé por API. Simple y sin features que no usás.",
  openGraph: {
    title: "Resender — La API relay para mensajes de Meta",
    description:
      "Recibí mensajes de Facebook en tu webhook y respondé por API. Simple y developer-first.",
    type: "website",
  },
}

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <PainPoint />
        <HowItWorks />
        <Quickstart />
        <FeaturesGrid />
        <PricingPreview />
        <About />
        <FaqSection id="faq" title={dict.faq.title} items={dict.faq.items} />
        <FinalCta
          title={dict.finalCta.title}
          subtitle={dict.finalCta.subtitle}
          cta={dict.finalCta.cta}
        />
      </main>
      <SiteFooter />
    </div>
  )
}
