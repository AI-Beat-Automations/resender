"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider } from "posthog-js/react"

// Solo publica por contexto el singleton que ya inicializó
// `instrumentation-client.ts` (corre antes de la hidratación), para que
// `usePostHog()` funcione en `sign-out-form` y `posthog-identify`.
//
// Recibe `client` y nunca `apiKey`: con `apiKey` el provider inicializaría por
// su cuenta y habría dos inits. Sin NEXT_PUBLIC_POSTHOG_KEY el singleton queda
// sin inicializar y sus métodos son no-ops; los consumidores igualmente
// comprueban `isPostHogEnabled`.
function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <PHProvider client={posthog}>{children}</PHProvider>
}

export { PostHogProvider }
