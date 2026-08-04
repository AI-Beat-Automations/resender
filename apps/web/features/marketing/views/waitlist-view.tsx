import Link from "next/link"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { JsonLd } from "@/components/json-ld"
import { Section } from "@/features/marketing/ui/section"
import { Typewriter } from "@/features/marketing/ui/typewriter"
import { joinWaitlistAction } from "@/features/waitlist/actions"
import { WaitlistForm } from "@/features/waitlist/ui/waitlist-form"
import { baseGraph, breadcrumbSchema, schemaGraph } from "@/lib/schema"
import { getDictionary, localePath, type Locale } from "@/content/i18n"
import { SITE_NAME } from "@/lib/site-config"
import { Button } from "@workspace/ui/components/button"

// Página pública de la lista de espera, compartida por `/waitlist` (ES) y
// `/en/waitlist` (EN). Es el enlace que se reparte en conferencias (ADR 0007),
// así que está pensada para leerse de pie y con una mano: encabezado corto a
// la izquierda, formulario a la derecha y, al final, el CTA de registro para
// quien ya le sirve Messenger hoy.
export function WaitlistView({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)
  const t = dict.waitlist.page

  return (
    <div className="light flex min-h-svh flex-col">
      <JsonLd
        data={schemaGraph(
          ...baseGraph(lang),
          breadcrumbSchema(
            [
              { name: SITE_NAME, path: "/" },
              { name: t.breadcrumb, path: "/waitlist" },
            ],
            lang
          )
        )}
      />
      <HtmlLang lang={lang} />
      <SiteBackground />
      <SiteHeader lang={lang} />
      <main className="flex-1">
        <Section>
          {/* Encabezado calcado del hero de la landing
              (`features/marketing/ui/hero.tsx`): mismo grid, mismos tamaños de
              tipografía y el mismo h1 en dos líneas con la segunda tipeada en
              `text-primary`. No se reusa `SectionHeading` porque eso es una
              cabecera de sección —centrada y un escalón más chica— y aquí el
              encabezado ES la pantalla: con la escala de sección el formulario
              pesaba más que el texto y la página se leía al revés. A la derecha
              va la pieza con la que se interactúa, que en el hero es la
              animación del flujo y aquí el formulario. En móvil el grid colapsa
              y el texto queda ANTES del formulario, que es el orden que pide un
              enlace repartido cara a cara y abierto horas después (ADR 0007). */}
          <div className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
            <div className="max-w-2xl">
              <p className="mb-4 font-mono text-sm text-primary">
                <span className="text-muted-foreground">{"// "}</span>
                {t.kicker}
              </p>
              <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
                {t.title}
                <br />
                <Typewriter className="text-primary" text={t.titleAccent} />
                <span
                  aria-hidden
                  className="caret-blink ml-1 inline-block h-[0.85em] w-[3px] translate-y-[1px] rounded-[1px] bg-primary align-baseline"
                />
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
                {t.subtitle}
              </p>
            </div>

            <WaitlistForm
              lang={lang}
              source="waitlist_page"
              action={joinWaitlistAction}
              className="md:mr-0 md:ml-auto"
            />
          </div>

          {/* Con el gate de acceso apagado (ADR 0007) este CTA ya no es humo:
              la cuenta nueva nace utilizable, así que a quien le sirve
              Messenger hoy no tiene nada que esperar. Ocupa el ancho completo
              de la sección y no una tarjeta: es el cierre de la página, un
              renglón separado por una regla, no una tercera caja compitiendo
              con el formulario. */}
          <div className="mt-16 flex flex-col gap-6 border-t border-border pt-10 sm:flex-row sm:items-center sm:justify-between sm:gap-12">
            <div className="max-w-2xl">
              <h2 className="font-heading text-lg font-bold tracking-tight">
                {t.registerTitle}
              </h2>
              <p className="mt-2 text-[14.5px]/[1.7] text-muted-foreground">
                {t.registerBody}
              </p>
            </div>
            <Button asChild size="lg" variant="outline" className="sm:shrink-0">
              <Link href={localePath("/register", lang)}>{t.registerCta}</Link>
            </Button>
          </div>
        </Section>
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
