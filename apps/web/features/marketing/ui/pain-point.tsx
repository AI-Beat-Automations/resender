import { Wallet, Unplug, Users, Zap, type LucideIcon } from "lucide-react"

import { Card } from "@workspace/ui/components/card"

import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { Reveal } from "@/features/marketing/ui/reveal"
import { QuestionMarquee } from "@/features/marketing/ui/question-marquee"
import { dict } from "@/content/i18n/es"

// Registro de iconos para los pain points (mapeados por `icon` en es.ts).
const icons: Record<string, LucideIcon> = {
  wallet: Wallet,
  unplug: Unplug,
  users: Users,
  zap: Zap,
}

export function PainPoint() {
  return (
    <Section>
      <SectionHeading
        kicker="el problema"
        title={dict.pain.title}
        subtitle={dict.pain.subtitle}
      />

      {/* Preguntas/quejas reales que se mueven (2 renglones). */}
      <div className="mt-12">
        <QuestionMarquee questions={dict.pain.questions} />
      </div>

      {/* Pain points en cards horizontales (2×2). */}
      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {dict.pain.items.map((item, i) => {
          const Icon = icons[item.icon] ?? Wallet
          return (
            <Reveal key={item.title} delay={i * 80}>
              <Card className="h-full flex-row items-start gap-4 p-6">
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
