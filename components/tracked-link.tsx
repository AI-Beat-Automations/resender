"use client"

import Link from "next/link"
import { usePostHog } from "posthog-js/react"

import { isPostHogEnabled } from "@/lib/posthog-client"

// Eventos explícitos de los CTAs del sitio público. El autocapture ya registra
// los clics, pero se rompe en cuanto cambia un texto o una clase; estos nombres
// son los que usan los dashboards y no dependen del diseño.
export type MarketingClickEvent =
  | "signup cta clicked"
  | "pricing plan clicked"
  | "docs link clicked"

// Un `next/link` que manda el evento antes de navegar (o varios, con las mismas
// propiedades: la card de un plan es a la vez un clic de plan y un CTA de
// registro). Funciona dentro de `<Button asChild>`: el `Slot` le pasa
// `className` y su propio `onClick`, y los dos se respetan. `page` sale de la URL al hacer clic, así las vistas que
// lo usan pueden seguir siendo componentes de servidor.
//
// Sin consentimiento de cookies el SDK está en opt-out y el `capture` es un
// no-op (ver `instrumentation-client.ts`).
function TrackedLink({
  event,
  properties,
  onClick,
  ...props
}: React.ComponentProps<typeof Link> & {
  event: MarketingClickEvent | MarketingClickEvent[]
  properties: Record<string, string | number | null>
}) {
  const posthog = usePostHog()

  return (
    <Link
      {...props}
      onClick={(clickEvent) => {
        if (isPostHogEnabled) {
          for (const name of Array.isArray(event) ? event : [event]) {
            posthog.capture(name, {
              ...properties,
              page: window.location.pathname,
            })
          }
        }
        onClick?.(clickEvent)
      }}
    />
  )
}

export { TrackedLink }
