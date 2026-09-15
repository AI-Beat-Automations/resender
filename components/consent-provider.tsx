"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import posthog from "posthog-js"

import { isPostHogEnabled } from "@/lib/posthog-client"
import type { ConsentDecision, ConsentState } from "@/lib/consent"
import {
  getConsentServerSnapshot,
  getConsentSnapshot,
  subscribeConsent,
  writeConsent,
} from "@/lib/consent-store"

// Estado del consentimiento de cookies para todo el árbol. Se lee de la cookie
// con `useSyncExternalStore`: en el servidor y durante la hidratación vale
// `undefined` (no hay `document`), y en el primer render de cliente ya trae la
// decisión real sin pasar por un estado intermedio.
//
// Cada cambio se aplica a PostHog aquí. El pixel de X no se «aplica»:
// `components/x-pixel.tsx` se monta o no según este mismo estado.

type ConsentContextValue = {
  /** `undefined` hasta hidratar; `null` cuando el visitante no decidió. */
  consent: ConsentState | undefined
  decide: (decision: ConsentDecision) => void
  /** Borra la decisión: el banner vuelve a aparecer. */
  reset: () => void
}

const ConsentContext = createContext<ConsentContextValue | null>(null)

export function ConsentProvider({ children }: { children: ReactNode }) {
  const consent = useSyncExternalStore(
    subscribeConsent,
    getConsentSnapshot,
    getConsentServerSnapshot
  )

  useEffect(() => {
    if (consent) applyToPostHog(consent)
  }, [consent])

  const decide = useCallback((decision: ConsentDecision) => {
    writeConsent(decision)
  }, [])
  const reset = useCallback(() => writeConsent(null), [])

  return (
    <ConsentContext value={{ consent, decide, reset }}>
      {children}
    </ConsentContext>
  )
}

export function useConsent(): ConsentContextValue {
  const value = useContext(ConsentContext)
  if (!value) throw new Error("useConsent fuera de <ConsentProvider>")
  return value
}

// PostHog arranca con `opt_out_capturing_by_default` (ver
// instrumentation-client.ts), así que el $pageview de la carga inicial no se
// captura. Al aceptar se emite uno a mano en lugar del `$opt_in` por defecto:
// así la primera visita con consentimiento cuenta como visita y no como un
// evento técnico. Los guards evitan reescribir la preferencia (y re-emitir el
// pageview) en cada montaje cuando el SDK ya la tiene.
function applyToPostHog(decision: ConsentDecision) {
  if (!isPostHogEnabled) return
  if (decision === "granted") {
    if (!posthog.has_opted_in_capturing()) {
      posthog.opt_in_capturing({ captureEventName: "$pageview" })
    }
    return
  }
  if (!posthog.has_opted_out_capturing()) posthog.opt_out_capturing()
}
