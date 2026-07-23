import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

import { FlowMock } from "@/features/marketing/ui/flow-mock"
import { dict } from "@/content/i18n/es"

export function Hero() {
  return (
    <section className="border-b border-border/60 bg-[radial-gradient(circle_at_top_left,var(--color-muted),transparent_38rem)]">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-[1.1fr_0.9fr] md:py-28">
        <div className="max-w-2xl">
          <p className="mb-4 font-mono text-sm text-primary">
            <span className="text-muted-foreground">{"// "}</span>
            {dict.hero.eyebrow}
          </p>
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            {dict.hero.title}{" "}
            <span className="text-primary">{dict.hero.titleAccent}</span>
            <span
              aria-hidden
              className="caret-blink ml-1 inline-block h-[0.85em] w-[3px] translate-y-[1px] rounded-[1px] bg-primary align-baseline"
            />
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
            {dict.hero.subtitle}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              {/* TODO: Stripe — por ahora el CTA va al registro existente. */}
              <Link href="/register">{dict.hero.ctaPrimary}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#how-it-works">{dict.hero.ctaSecondary}</Link>
            </Button>
          </div>
        </div>
        <FlowMock />
      </div>
    </section>
  )
}
