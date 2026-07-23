import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { PlanCards } from "@/features/marketing/ui/plan-cards"
import { dict } from "@/content/i18n/es"

export function PricingPreview() {
  return (
    <Section id="pricing">
      <SectionHeading
        kicker="pricing"
        title={dict.pricingPreview.title}
        subtitle={dict.pricingPreview.subtitle}
      />
      <div className="mt-16">
        <PlanCards />
      </div>
      <div className="mt-10 text-center">
        <Button asChild variant="outline" size="lg">
          <Link href="/pricing">{dict.pricingPreview.cta}</Link>
        </Button>
      </div>
    </Section>
  )
}
