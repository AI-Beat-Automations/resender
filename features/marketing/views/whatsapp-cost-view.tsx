import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { JsonLd } from "@/components/json-ld"
import { Button } from "@/components/ui/button"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { WhatsappCostEstimator } from "@/features/marketing/ui/whatsapp-cost-estimator"
import { FaqSection } from "@/features/marketing/ui/faq-section"
import {
  ComingSoonDot,
  WhatsappWaitlistCta,
} from "@/features/marketing/ui/whatsapp-waitlist-cta"
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
// informa el cargo de Meta: Resender no lo cobra (ADR 0023), por eso el
// resultado nunca suma el plan. WhatsApp todavía no está disponible, así que el
// cierre es la lista de espera y no un CTA de compra.
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
          {/* WhatsApp todavía no está en Resender: se avisa desde el hero y no
              recién en el cierre, para que nadie lea la página como si ya
              pudiera conectar su número. */}
          <p className="mt-6 text-center">
            <Link
              href="#waitlist"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ComingSoonDot />
              {whatsappCost.heroSoon.text}
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                {whatsappCost.heroSoon.cta}
                <ArrowRight className="size-3.5" aria-hidden />
              </span>
            </Link>
          </p>
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
          title={whatsappCost.faq.title}
          items={whatsappCost.faq.items}
        />

        <WhatsappWaitlistCta lang={lang} copy={whatsappCost.cta} />
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
