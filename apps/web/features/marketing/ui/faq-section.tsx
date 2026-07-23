import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@workspace/ui/components/accordion"

import { Section, SectionHeading } from "@/features/marketing/ui/section"

// Sección de FAQ reutilizable (landing y pricing). Recibe título e items.
export function FaqSection({
  id,
  kicker = "faq",
  title,
  items,
  tone = "base",
}: {
  id?: string
  kicker?: string
  title: string
  items: ReadonlyArray<{ q: string; a: string }>
  tone?: "base" | "muted"
}) {
  return (
    <Section id={id} tone={tone}>
      <SectionHeading kicker={kicker} title={title} />
      <div className="mx-auto mt-12 max-w-3xl">
        <Accordion type="single" collapsible>
          {items.map((item, i) => (
            <AccordionItem key={item.q} value={`item-${i}`}>
              <AccordionTrigger className="text-left text-base font-medium">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  )
}
