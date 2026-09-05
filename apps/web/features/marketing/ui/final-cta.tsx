import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

import { localePath, type Locale } from "@/content/i18n"

// CTA final reutilizable (landing, pricing y post de blog). Sección destacada
// con color de contraste: `bg-foreground`/`text-background`, invirtiendo el
// tono respecto del resto de la página. El botón también se invierte (fondo
// `background`, texto `foreground`): sobre el gris oscuro el violeta del
// primario no contrasta lo suficiente (mock `1a`).
export function FinalCta({
  lang,
  title,
  subtitle,
  cta,
  secondary,
}: {
  lang: Locale
  title: string
  subtitle: string
  cta: string
  // Camino secundario opcional debajo del botón: hoy solo la landing lo usa,
  // con el formulario de la lista de espera (ADR 0007). El CTA primario sigue
  // siendo «Empieza», así que esto va después, separado por una línea, y quien
  // no lo pasa (/pricing, los posts del blog) renderiza exactamente lo de
  // antes.
  secondary?: React.ReactNode
}) {
  return (
    <section className="bg-foreground text-background">
      <div className="mx-auto w-full max-w-4xl px-6 py-24 text-center">
        <h2 className="text-3xl font-bold tracking-[-0.03em] md:text-5xl">
          {title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-background/70">
          {subtitle}
        </p>
        <div className="mt-8">
          <Button
            asChild
            size="lg"
            className="bg-background text-foreground hover:bg-background/90"
          >
            {/* TODO: Stripe — por ahora el CTA va al registro existente. */}
            <Link href={localePath("/register", lang)}>{cta}</Link>
          </Button>
        </div>
        {secondary ? (
          <div className="mt-12 border-t border-background/15 pt-12">
            {secondary}
          </div>
        ) : null}
      </div>
    </section>
  )
}
