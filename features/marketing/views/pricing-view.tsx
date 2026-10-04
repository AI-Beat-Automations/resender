import Link from "next/link"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { PlanCards } from "@/features/marketing/ui/plan-cards"
import { EnterpriseCta } from "@/features/marketing/ui/enterprise-cta"
import { ComparisonTable } from "@/features/marketing/ui/comparison-table"
import { FaqSection } from "@/features/marketing/ui/faq-section"
import { FinalCta } from "@/features/marketing/ui/final-cta"
import { JsonLd } from "@/components/json-ld"
import {
  baseGraph,
  breadcrumbSchema,
  faqSchema,
  schemaGraph,
  softwareApplicationSchema,
} from "@/lib/schema"
import { getDictionary, localePath, type Locale } from "@/content/i18n"
import { SITE_NAME } from "@/lib/site-config"

// Página de precios compartida por `/pricing` (ES) y `/en/pricing` (EN).
export function PricingView({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)

  return (
    <div className="light flex min-h-svh flex-col">
      <JsonLd
        data={schemaGraph(
          ...baseGraph(lang),
          softwareApplicationSchema(dict.pricing.plans, lang),
          faqSchema(dict.pricingFaq.items, lang),
          breadcrumbSchema(
            [
              { name: SITE_NAME, path: "/" },
              { name: dict.pricing.title, path: "/pricing" },
            ],
            lang
          )
        )}
      />
      <HtmlLang lang={lang} />
      <SiteBackground />
      <SiteHeader lang={lang} />
      <main className="flex-1">
        <Section>
          <SectionHeading
            as="h1"
            kicker={dict.pricing.kicker}
            title={dict.pricing.title}
            subtitle={dict.pricing.subtitle}
          />
          <div className="mt-16">
            <PlanCards lang={lang} location="pricing" />
          </div>
          <div className="mt-6">
            <EnterpriseCta lang={lang} />
          </div>
          <div className="mx-auto mt-16 max-w-2xl space-y-6 leading-8 text-muted-foreground">
            {dict.pricing.intro.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <p className="rounded-xl border border-border bg-muted/40 px-5 py-4 text-sm leading-7">
              {dict.pricing.metaNote}{" "}
              <Link
                href={localePath("/whatsapp-cost-calculator", lang)}
                className="font-medium text-foreground underline underline-offset-4"
              >
                {dict.whatsappCostPromo.cta}
              </Link>
            </p>
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
          location="pricing"
        />
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
