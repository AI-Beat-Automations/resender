import {
  Code2,
  Wallet,
  Zap,
  Plug,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react"

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from "@workspace/ui/components/card"

import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { dict } from "@/content/i18n/es"

// Registro de iconos. Incluye TODOS los iconos —también los de features ocultas
// (wallet, messages)— para conservarlos y poder reusarlos en el futuro.
const icons: Record<string, LucideIcon> = {
  code: Code2,
  wallet: Wallet,
  zap: Zap,
  plug: Plug,
  messages: MessagesSquare,
}

export function FeaturesGrid() {
  const items = dict.features.items.filter(
    (item) => !("hidden" in item && item.hidden)
  )

  return (
    <Section tone="muted">
      <SectionHeading
        kicker="features"
        title={dict.features.title}
        subtitle={dict.features.subtitle}
      />
      <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const Icon = icons[item.icon] ?? Code2
          return (
            <Card key={item.title}>
              <CardHeader>
                <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <CardAction className="font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </CardAction>
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.body}</CardDescription>
              </CardHeader>
            </Card>
          )
        })}
      </div>
    </Section>
  )
}
