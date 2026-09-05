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
// La Pro lleva borde primario y el badge «Recomendado» flotando sobre el borde
// (mock `1m`); por eso la Card suelta su `overflow-hidden`, que lo recortaría.
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
            "relative flex flex-col overflow-visible ring-0",
            plan.featured ? "border-2 border-primary" : "border border-border"
          )}
        >
          <CardHeader>
            {plan.badge ? (
              <Badge className="absolute -top-2.5 right-5">{plan.badge}</Badge>
            ) : null}
            <CardTitle className="text-xl font-semibold">{plan.name}</CardTitle>
            <CardDescription>{plan.description}</CardDescription>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-heading text-[40px] leading-none font-bold tracking-[-0.03em]">
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
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          ) : null}

          {/* Sin la banda gris del footer de Card: en el mock el CTA va a ras
              del cuerpo de la tarjeta. */}
          <CardFooter className="mt-auto border-0 bg-transparent pt-0">
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
