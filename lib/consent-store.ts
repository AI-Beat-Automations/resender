// Store mínimo del consentimiento para `useSyncExternalStore`. La fuente de
// verdad es la cookie; este módulo solo añade la suscripción que la cookie no
// tiene, para que quien la escriba (la tarjeta, el link del footer) haga
// re-renderizar a quien la lee (el pixel).
//
// `undefined` es «todavía no sé» (render de servidor e hidratación) y `null` es
// «leí la cookie y no hay decisión». La diferencia importa: el banner solo se
// muestra en el segundo caso.

import {
  clearConsentCookieValue,
  consentCookieValue,
  readConsent,
  type ConsentState,
} from "./consent"

const listeners = new Set<() => void>()

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getConsentSnapshot(): ConsentState {
  return readConsent(document.cookie)
}

export function getConsentServerSnapshot(): undefined {
  return undefined
}

export function writeConsent(state: ConsentState): void {
  document.cookie = state
    ? consentCookieValue(state)
    : clearConsentCookieValue()
  for (const listener of listeners) listener()
}
