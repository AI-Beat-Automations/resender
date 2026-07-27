import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { Hero } from "@/features/marketing/ui/hero"
import { PainPoint } from "@/features/marketing/ui/pain-point"
import { HowItWorks } from "@/features/marketing/ui/how-it-works"
import { Quickstart } from "@/features/marketing/ui/quickstart"
import { PricingPreview } from "@/features/marketing/ui/pricing-preview"
import { FaqSection } from "@/features/marketing/ui/faq-section"
import { FinalCta } from "@/features/marketing/ui/final-cta"
import { getDictionary, type Locale } from "@/content/i18n"

// Landing compartida por `/` (ES) y `/en` (EN). Cada ruta solo renderiza esta
// vista con su `lang` y exporta su propio metadata.
export function LandingView({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)

  return (
    <div className="flex min-h-svh flex-col">
      <HtmlLang lang={lang} />
      <SiteBackground />
      <SiteHeader lang={lang} />
      <main className="flex-1">
        <Hero lang={lang} />
        <PainPoint lang={lang} />
        <HowItWorks lang={lang} />
        <Quickstart lang={lang} />
        <PricingPreview lang={lang} />
        <FaqSection
          id="faq"
          kicker={dict.faq.kicker}
          title={dict.faq.title}
          items={dict.faq.items}
        />
        <FinalCta
          lang={lang}
          title={dict.finalCta.title}
          subtitle={dict.finalCta.subtitle}
          cta={dict.finalCta.cta}
        />
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
