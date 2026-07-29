import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { PlanCards } from "@/features/marketing/ui/plan-cards"
import { getDictionary, localePath, type Locale } from "@/content/i18n"

export function PricingPreview({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)

  return (
    <Section id="pricing">
      <SectionHeading
        kicker={dict.pricingPreview.kicker}
        title={dict.pricingPreview.title}
        subtitle={dict.pricingPreview.subtitle}
      />
      <div className="mt-16">
        <PlanCards lang={lang} />
      </div>
      <div className="mt-10 text-center">
        <Button asChild variant="outline" size="lg">
          <Link href={localePath("/pricing", lang)}>
            {dict.pricingPreview.cta}
          </Link>
        </Button>
      </div>
    </Section>
  )
}
