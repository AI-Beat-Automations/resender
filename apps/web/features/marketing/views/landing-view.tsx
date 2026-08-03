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
import { joinWaitlistAction } from "@/features/waitlist/actions"
import { WaitlistForm } from "@/features/waitlist/ui/waitlist-form"
import { JsonLd } from "@/components/json-ld"
import { landingGraph } from "@/lib/schema"
import { getDictionary, type Locale } from "@/content/i18n"

// Landing compartida por `/` (ES) y `/en` (EN). Cada ruta solo renderiza esta
// vista con su `lang` y exporta su propio metadata.
export function LandingView({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)

  return (
    <div className="light flex min-h-svh flex-col">
      <JsonLd data={landingGraph(lang)} />
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
          // La lista de espera se fusiona en el cierre existente en vez de
          // ocupar una sección propia debajo de los precios (ADR 0007): un
          // solo momento de decisión, con «Empieza» arriba como acción
          // primaria y esto como salida para quien todavía no puede comprar.
          // La action se importa acá, en el componente servidor, y baja como
          // prop, igual que `login-view.tsx` con `loginAction`.
          secondary={
            <WaitlistForm
              lang={lang}
              source="landing"
              action={joinWaitlistAction}
            />
          }
        />
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
