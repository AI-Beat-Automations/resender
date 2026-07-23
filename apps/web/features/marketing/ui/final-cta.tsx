import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

// CTA final reutilizable (landing y pricing).
export function FinalCta({
  title,
  subtitle,
  cta,
}: {
  title: string
  subtitle: string
  cta: string
}) {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-4xl px-6 py-24 text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-5xl">{title}</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
          {subtitle}
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            {/* TODO: Stripe — por ahora el CTA va al registro existente. */}
            <Link href="/register">{cta}</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
