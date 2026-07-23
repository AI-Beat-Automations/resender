import { Wallet, Boxes, Unplug, type LucideIcon } from "lucide-react"

import { Card } from "@workspace/ui/components/card"

import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { Reveal } from "@/features/marketing/ui/reveal"
import { dict } from "@/content/i18n/es"

// Registro de iconos para los pain points (mapeados por `icon` en es.ts).
const icons: Record<string, LucideIcon> = {
  wallet: Wallet,
  boxes: Boxes,
  unplug: Unplug,
}

// Pain points como cards verticales que aparecen (fade + slide-up) a medida que
// se scrollea. Reemplaza el bloque de texto anterior.
export function PainPoint() {
  return (
    <Section tone="muted">
      <SectionHeading
        kicker="el problema"
        title={dict.pain.title}
        subtitle={dict.pain.subtitle}
      />
      <div className="mx-auto mt-16 flex max-w-2xl flex-col gap-6">
        {dict.pain.items.map((item, i) => {
          const Icon = icons[item.icon] ?? Wallet
          return (
            <Reveal key={item.title} delay={i * 100}>
              <Card className="flex-row items-start gap-4 p-6">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              </Card>
            </Reveal>
          )
        })}
      </div>
    </Section>
  )
}
