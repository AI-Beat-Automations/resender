import Link from "next/link"
import { Check } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import { getDictionary, localePath, type Locale } from "@/content/i18n"

// Cards de planes. Reutilizado por la preview de la landing y la página /pricing.
// `showFeatures` controla si se listan los features (full) o no (preview).
export function PlanCards({
  lang,
  showFeatures = true,
}: {
  lang: Locale
  showFeatures?: boolean
}) {
  const dict = getDictionary(lang)

  return (
    <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2">
      {dict.pricing.plans.map((plan) => (
        <Card
          key={plan.name}
          className={cn(
            "flex flex-col",
            plan.featured && "ring-2 ring-primary"
          )}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">{plan.name}</CardTitle>
              {plan.badge ? <Badge>{plan.badge}</Badge> : null}
            </div>
            <CardDescription>{plan.description}</CardDescription>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-heading text-4xl font-bold">
                {plan.price}
              </span>
              <span className="text-sm text-muted-foreground">
                {plan.period}
              </span>
            </div>
          </CardHeader>

          {showFeatures ? (
            <CardContent className="flex-1">
              <ul className="space-y-3 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          ) : null}

          <CardFooter>
            <Button
              asChild
              className="w-full"
              variant={plan.featured ? "default" : "outline"}
            >
              {/* TODO: Stripe — por ahora el CTA va al registro existente. */}
              <Link href={localePath("/register", lang)}>{plan.cta}</Link>
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
