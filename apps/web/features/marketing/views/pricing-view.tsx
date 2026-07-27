import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { PlanCards } from "@/features/marketing/ui/plan-cards"
import { ComparisonTable } from "@/features/marketing/ui/comparison-table"
import { FaqSection } from "@/features/marketing/ui/faq-section"
import { FinalCta } from "@/features/marketing/ui/final-cta"
import { getDictionary, type Locale } from "@/content/i18n"

// Página de precios compartida por `/pricing` (ES) y `/en/pricing` (EN).
export function PricingView({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)

  return (
    <div className="flex min-h-svh flex-col">
      <HtmlLang lang={lang} />
      <SiteBackground />
      <SiteHeader lang={lang} />
      <main className="flex-1">
        <Section>
          <SectionHeading
            kicker={dict.pricing.kicker}
            title={dict.pricing.title}
            subtitle={dict.pricing.subtitle}
          />
          <div className="mt-16">
            <PlanCards lang={lang} />
          </div>
        </Section>

        <ComparisonTable lang={lang} />

        <FaqSection
          kicker={dict.pricingFaq.kicker}
          title={dict.pricingFaq.title}
          items={dict.pricingFaq.items}
        />

        <FinalCta
          lang={lang}
          title={dict.pricingCta.title}
          subtitle={dict.pricingCta.subtitle}
          cta={dict.pricingCta.cta}
        />
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
