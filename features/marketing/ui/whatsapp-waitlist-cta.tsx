import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { joinWaitlistAction } from "@/features/waitlist/actions"
import { WaitlistForm } from "@/features/waitlist/ui/waitlist-form"
import { localePath, type Dict, type Locale } from "@/content/i18n"

// Cierre de /whatsapp-cost-calculator. Calca el cierre de la landing (sección
// `bg-foreground`/`text-background` con la tarjeta de la lista de espera), pero
// invierte el orden: WhatsApp todavía no está disponible en Resender, así que
// quien llega a esta página no tiene nada que comprar para ese canal. La lista
// de espera pasa a ser la acción principal y los planes quedan abajo, como
// salida para quien ya atiende por Messenger o Instagram.
//
// La action se importa acá, en el componente servidor, y baja como prop, igual
// que en `landing-view.tsx`.
export function WhatsappWaitlistCta({
  lang,
  copy,
}: {
  lang: Locale
  copy: Dict["whatsappCost"]["cta"]
}) {
  return (
    <section
      id="waitlist"
      className="scroll-mt-20 bg-foreground text-background"
    >
      <div className="mx-auto w-full max-w-4xl px-6 py-24 text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-background/20 px-3 py-1 font-mono text-xs text-background/80">
          <ComingSoonDot />
          {copy.badge}
        </p>
        <h2 className="mt-6 text-3xl font-bold tracking-tight md:text-5xl">
          {copy.title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-background/70">
          {copy.subtitle}
        </p>

        <WaitlistForm
          lang={lang}
          source="whatsapp_cost_calculator"
          action={joinWaitlistAction}
          title={copy.formTitle}
          subtitle={copy.formSubtitle}
          className="mt-10"
        />

        <div className="mt-12 border-t border-background/15 pt-8 text-sm text-background/70">
          <p>
            {copy.fallback}{" "}
            <Link
              href={localePath("/pricing", lang)}
              className="inline-flex items-center gap-1 font-medium text-background underline-offset-4 hover:underline"
            >
              {copy.fallbackCta}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </p>
        </div>
      </div>
    </section>
  )
}

// Punto que late de «próximamente». Lo comparten el cierre y el aviso del hero
// del estimador. Sin animación si la persona pidió reducir el movimiento.
export function ComingSoonDot() {
  return (
    <span className="relative flex size-2" aria-hidden>
      <span className="absolute inline-flex size-full rounded-full bg-primary opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-primary" />
    </span>
  )
}
