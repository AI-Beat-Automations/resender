// Espejo cliente de `lib/posthog.ts`. A propósito NO importa `posthog-js`: así
// puede importarse desde cualquier sitio (incluido código de servidor) sin
// arrastrar el SDK de navegador al bundle del Worker.
//
// Next inlinea las `process.env.NEXT_PUBLIC_*` en tiempo de build, así que si la
// variable falta en el build estas constantes quedan vacías y todo el cableado
// de PostHog en el navegador se vuelve un no-op silencioso. Por eso las
// `NEXT_PUBLIC_POSTHOG_*` viven en `globalEnv` de turbo.json y en el `env:` de
// los workflows de deploy: sin ellas presentes al compilar, no hay analítica.
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ""

export const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com"

export const isPostHogEnabled = POSTHOG_KEY.length > 0
