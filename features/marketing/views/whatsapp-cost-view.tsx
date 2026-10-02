import Link from "next/link"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { JsonLd } from "@/components/json-ld"
import { Button } from "@/components/ui/button"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { WhatsappCostEstimator } from "@/features/marketing/ui/whatsapp-cost-estimator"
import { FaqSection } from "@/features/marketing/ui/faq-section"
import { FinalCta } from "@/features/marketing/ui/final-cta"
import {
  baseGraph,
  breadcrumbSchema,
  faqSchema,
  schemaGraph,
} from "@/lib/schema"
import { SITE_NAME } from "@/lib/site-config"
import { getDictionary, type Locale } from "@/content/i18n"

// Estimador público de lo que Meta cobra por WhatsApp, compartido por
// `/whatsapp-cost-calculator` (ES) y `/en/whatsapp-cost-calculator`. Solo
// informa el cargo de Meta: Resender no lo cobra (ADR 0023), por eso el CTA
// final va a /pricing y el resultado nunca suma el plan.
export function WhatsappCostView({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)
  const { whatsappCost } = dict

  return (
    <div className="light flex min-h-svh flex-col">
      <JsonLd
        data={schemaGraph(
          ...baseGraph(lang),
          faqSchema(whatsappCost.faq.items, lang),
          breadcrumbSchema(
            [
              { name: SITE_NAME, path: "/" },
              { name: whatsappCost.title, path: "/whatsapp-cost-calculator" },
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
            kicker={whatsappCost.kicker}
            title={whatsappCost.title}
            subtitle={whatsappCost.subtitle}
          />
          <div className="mt-8 text-center">
            <Button asChild size="lg">
              <Link href="#calculator">{whatsappCost.heroCta}</Link>
            </Button>
          </div>

        </Section>

        <WhatsappCostEstimator lang={lang} copy={whatsappCost} />

        <Section>
          <div className="mx-auto max-w-4xl">
            <h2 className="text-center text-2xl font-bold tracking-tight">
              {whatsappCost.changes.title}
            </h2>
            <dl className="mt-10 grid gap-8 sm:grid-cols-2">
              {whatsappCost.changes.items.map((item) => (
                <div key={item.title}>
                  <dt className="font-semibold">{item.title}</dt>
                  <dd className="mt-2 text-muted-foreground">{item.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Section>

        <FaqSection
          tone="muted-solid"
          title={whatsappCost.faq.title}
          items={whatsappCost.faq.items}
        />

        <FinalCta
          lang={lang}
          title={whatsappCost.cta.title}
          subtitle={whatsappCost.cta.subtitle}
          cta={whatsappCost.cta.cta}
          href="/pricing"
        />
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
