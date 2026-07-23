import { Link2, Webhook, Inbox, Send } from "lucide-react"

import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { Reveal } from "@/features/marketing/ui/reveal"
import { dict } from "@/content/i18n/es"

const icons = [Link2, Webhook, Inbox, Send]

// Línea de tiempo: nodos conectados por una línea (horizontal en desktop,
// vertical en mobile). Cada paso aparece con un pequeño stagger al scrollear.
export function HowItWorks() {
  return (
    <Section id="how-it-works">
      <SectionHeading
        kicker="flujo"
        title={dict.howItWorks.title}
        subtitle={dict.howItWorks.subtitle}
      />
      <ol className="relative mt-16 grid gap-10 md:grid-cols-4">
        {/* Línea conectora (desktop) — pasa por detrás de los nodos. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-6 hidden h-px bg-border md:block"
        />
        {dict.howItWorks.steps.map((step, i) => {
          const Icon = icons[i] ?? Link2
          return (
            <li key={step.title}>
              <Reveal delay={i * 100} className="flex flex-col md:items-start">
                <div className="relative z-10 flex size-12 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground">
                  <Icon className="size-5" />
                </div>
                <span className="mt-4 font-mono text-xs text-muted-foreground">
                  Paso 0{i + 1}
                </span>
                <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </Reveal>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}
