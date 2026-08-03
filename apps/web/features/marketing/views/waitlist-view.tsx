import Link from "next/link"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { JsonLd } from "@/components/json-ld"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { joinWaitlistAction } from "@/features/waitlist/actions"
import { WaitlistForm } from "@/features/waitlist/ui/waitlist-form"
import { baseGraph, breadcrumbSchema, schemaGraph } from "@/lib/schema"
import { getDictionary, localePath, type Locale } from "@/content/i18n"
import { SITE_NAME } from "@/lib/site-config"
import { Button } from "@workspace/ui/components/button"

// Página pública de la lista de espera, compartida por `/waitlist` (ES) y
// `/en/waitlist` (EN). Es el enlace que se reparte en conferencias (ADR 0007),
// así que está pensada para leerse de pie y con una mano: encabezado corto,
// explicación breve de qué es Resender, el formulario y, al final, el CTA de
// registro para quien ya le sirve Messenger hoy.
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
              { name: t.title, path: "/waitlist" },
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
          <SectionHeading
            as="h1"
            kicker={t.kicker}
            title={t.title}
            subtitle={t.subtitle}
          />
          {/* La explicación va ANTES del formulario: el enlace se reparte en
              una conversación cara a cara y se abre horas después, así que hay
              que recordarle a la persona a qué se está anotando antes de
              pedirle el correo (ADR 0007). Es breve a propósito, para que el
              formulario siga entrando en la primera pantalla de un teléfono. */}
          <div className="mx-auto mt-10 max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight">
              {t.whatIsTitle}
            </h2>
            <p className="mt-4 leading-8 text-muted-foreground">
              {t.whatIsBody}
            </p>
          </div>

          <div className="mt-12">
            <WaitlistForm
              lang={lang}
              source="waitlist_page"
              action={joinWaitlistAction}
            />
          </div>

          {/* Con el gate de acceso apagado (ADR 0007) este CTA ya no es humo:
              la cuenta nueva nace utilizable, así que a quien le sirve
              Messenger hoy no tiene nada que esperar. */}
          <div className="mx-auto mt-12 max-w-2xl rounded-xl border border-border bg-card p-6 text-card-foreground">
            <h2 className="text-lg font-bold tracking-tight">
              {t.registerTitle}
            </h2>
            <p className="mt-2 text-[14.5px]/[1.7] text-muted-foreground">
              {t.registerBody}
            </p>
            <Button asChild size="lg" variant="outline" className="mt-5">
              <Link href={localePath("/register", lang)}>{t.registerCta}</Link>
            </Button>
          </div>
        </Section>
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
