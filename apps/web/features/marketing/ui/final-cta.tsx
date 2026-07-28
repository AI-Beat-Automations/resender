import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

import { localePath, type Locale } from "@/content/i18n"

// CTA final reutilizable (landing, pricing y post de blog). Sección destacada
// con color de contraste: `bg-foreground`/`text-background`, así en modo claro
// se ve con el morado oscuro de la marca y en modo oscuro con el crema —
// invirtiendo el tono respecto del resto de la página.
export function FinalCta({
  lang,
  title,
  subtitle,
  cta,
}: {
  lang: Locale
  title: string
  subtitle: string
  cta: string
}) {
  return (
    <section className="bg-foreground text-background">
      <div className="mx-auto w-full max-w-4xl px-6 py-24 text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-5xl">{title}</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-background/70">
          {subtitle}
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            {/* TODO: Stripe — por ahora el CTA va al registro existente. */}
            <Link href={localePath("/register", lang)}>{cta}</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
