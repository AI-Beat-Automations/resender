import posthog from "posthog-js"

import {
  isPostHogEnabled,
  POSTHOG_HOST,
  POSTHOG_KEY,
} from "@/lib/posthog-client"

// Convención `instrumentation-client.ts` de Next: corre en el navegador después
// de cargar el HTML y ANTES de la hidratación de React. Es el único sitio donde
// se inicializa posthog-js; `components/posthog-provider.tsx` solo publica el
// cliente por contexto.
//
// Va aquí y no en un `useEffect` porque (a) este fichero solo entra al bundle de
// cliente, así que es imposible que posthog-js acabe en el Worker de OpenNext,
// (b) captura el primer $pageview sin competir con la hidratación y (c) no sufre
// el doble montaje de StrictMode, que provocaría «You have already initialized
// PostHog!» en dev.
if (isPostHogEnabled) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // El App Router navega con la History API. Sin `history_change` solo habría
    // un $pageview por carga completa: moverse entre /connections, /messages y
    // /settings no generaría ninguno. Los $pageleave vienen de propina, porque
    // su default (`if_capture_pageview`) los activa junto a los pageviews.
    capture_pageview: "history_change",
    // Los visitantes anónimos de la landing y el blog no crean person profile:
    // solo lo hacen al identificarse (ver components/posthog-identify.tsx). Es
    // el default del SDK, explícito aquí para que no lo cambie una subida de
    // versión.
    person_profiles: "identified_only",
    // `disable_session_recording` se deja sin tocar a propósito: quien manda
    // sobre el replay es el panel del proyecto en PostHog, no el código.
  })
} else if (process.env.NODE_ENV !== "production") {
  // Mismo texto que `lib/posthog.ts` para que ambos runtimes fallen igual.
  console.warn(
    "NEXT_PUBLIC_POSTHOG_KEY variable required by PostHog is missing or un-configured, " +
      "this causes events to be silently missed. " +
      "This error stops appearing once NEXT_PUBLIC_POSTHOG_KEY is configured"
  )
}
