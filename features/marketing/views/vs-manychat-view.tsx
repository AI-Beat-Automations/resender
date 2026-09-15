import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { JsonLd } from "@/components/json-ld"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { ComparisonTable } from "@/features/marketing/ui/comparison-table"
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

// Página comparativa, compartida por `/vs-manychat` (ES) y `/en/vs-manychat`.
//
// Existe como ruta propia y no como sección de /pricing porque "alternativa a
// manychat" / "manychat api" son búsquedas con intención de compra: necesitan
// una URL que puedan rankear, con su propio title, H1 y FAQ.
export function VsManychatView({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)
  const { vsManychat } = dict

  return (
    <div className="light flex min-h-svh flex-col">
      <JsonLd
        data={schemaGraph(
          ...baseGraph(lang),
          faqSchema(vsManychat.faq.items, lang),
          breadcrumbSchema(
            [
              { name: SITE_NAME, path: "/" },
              { name: vsManychat.title, path: "/vs-manychat" },
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
            kicker={vsManychat.kicker}
            title={vsManychat.title}
            subtitle={vsManychat.subtitle}
          />
          <div className="mx-auto mt-12 max-w-2xl space-y-6 text-lg leading-8 text-muted-foreground">
            {vsManychat.intro.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </Section>

        <ComparisonTable lang={lang} />

        <Section>
          <SectionHeading title={vsManychat.verdict.title} />
          <dl className="mx-auto mt-12 max-w-3xl divide-y divide-border">
            {vsManychat.verdict.items.map((item) => (
              <div
                key={item.when}
                className="grid gap-2 py-6 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-8"
              >
                <dt className="font-medium">{item.when}</dt>
                <dd className="text-muted-foreground">{item.pick}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <FaqSection
          tone="muted"
          title={vsManychat.faq.title}
          items={vsManychat.faq.items}
        />

        <FinalCta
          lang={lang}
          title={vsManychat.cta.title}
          subtitle={vsManychat.cta.subtitle}
          cta={vsManychat.cta.cta}
        />
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
