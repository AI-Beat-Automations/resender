"use client"

import { useConsent } from "@/components/consent-provider"

// Entrada «Cookies» del footer. Borra la decisión guardada para que la tarjeta
// de consentimiento vuelva a aparecer: es el único camino para cambiar de
// opinión antes de que la cookie caduque.
export function CookieSettingsLink({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  const { reset } = useConsent()
  return (
    <button type="button" onClick={reset} className={className}>
      {label}
    </button>
  )
}
