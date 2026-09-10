"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSyncExternalStore } from "react"

import { Button } from "@workspace/ui/components/button"

import { useConsent } from "@/components/consent-provider"
import { resolveConsentLocale } from "@/lib/consent"
import type { Locale } from "@/content/i18n"

const subscribeNoop = () => () => {}

// Tarjeta de consentimiento. Vive en el layout raíz y por eso no puede usar ni
// el diccionario público (necesita `lang` por prop) ni el de la app (contexto
// que solo existe bajo `(product)`): el copy es corto y va acá, en los dos
// idiomas, y el idioma se deduce del path o de la cookie de preferencia.
//
// Abajo a la derecha en escritorio y a ancho completo en móvil: no tapa el
// hero ni el CTA de la landing, y dentro de la app no pisa el sidebar.
const COPY: Record<
  Locale,
  {
    title: string
    body: string
    policy: string
    reject: string
    accept: string
  }
> = {
  es: {
    title: "Cookies",
    body: "Usamos cookies para analítica de producto y para medir nuestros anuncios. Puedes cambiar tu decisión desde el pie de página.",
    policy: "Política de privacidad",
    reject: "Rechazar",
    accept: "Aceptar",
  },
  en: {
    title: "Cookies",
    body: "We use cookies for product analytics and to measure our ads. You can change your choice from the footer.",
    policy: "Privacy policy",
    reject: "Reject",
    accept: "Accept",
  },
}

export function CookieConsent() {
  const { consent, decide } = useConsent()
  const pathname = usePathname()
  // La cookie de idioma solo se conoce en el navegador; en el servidor se usa
  // el idioma del path, que en la app es español (igual que el default del
  // servidor). Da igual que difiera: la tarjeta no se renderiza hasta hidratar.
  const lang = useSyncExternalStore(
    subscribeNoop,
    () => resolveConsentLocale(pathname, document.cookie),
    () => resolveConsentLocale(pathname, "")
  )

  if (consent !== null) return null
  const copy = COPY[lang]

  return (
    <section
      role="dialog"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-body"
      className="fixed inset-x-4 bottom-4 z-50 rounded-2xl bg-card p-4 text-sm text-card-foreground shadow-lg ring-1 ring-foreground/10 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-90"
    >
      <h2
        id="cookie-consent-title"
        className="font-heading text-base font-semibold"
      >
        {copy.title}
      </h2>
      <p id="cookie-consent-body" className="mt-1.5 text-muted-foreground">
        {copy.body}{" "}
        <Link
          href="/privacy"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {copy.policy}
        </Link>
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => decide("denied")}>
          {copy.reject}
        </Button>
        <Button onClick={() => decide("granted")}>{copy.accept}</Button>
      </div>
    </section>
  )
}
