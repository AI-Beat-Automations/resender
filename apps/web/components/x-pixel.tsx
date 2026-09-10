"use client"

import Script from "next/script"
import { usePathname } from "next/navigation"
import { useSyncExternalStore } from "react"

import { useConsent } from "@/components/consent-provider"
import { isXPixelHost, isXPixelPath } from "@/lib/consent"

// Pixel de conversión de X (Twitter Ads). Solo el código base: `config` emite
// un PageView por carga completa. Los eventos de conversión (registro,
// waitlist) se agregan cuando existan sus ids `tw-rf63m-…` en X Ads.
//
// El id va fijo a propósito: no hay entorno de X que no sea producción, y la
// condición de «solo producción» la resuelve el hostname (ver lib/consent.ts).
// Carga únicamente con consentimiento, fuera de la app logueada y en
// resender.dev. Las tres condiciones se evalúan en el navegador.
export const X_PIXEL_ID = "rf63m"

const subscribeNoop = () => () => {}

const X_PIXEL_SNIPPET = `!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','${X_PIXEL_ID}');`

export function XPixel() {
  const { consent } = useConsent()
  const pathname = usePathname()
  // El host solo existe en el navegador; en el servidor vale "" y el pixel no
  // se renderiza, que es lo correcto para un script que no debe ir en el HTML.
  const hostname = useSyncExternalStore(
    subscribeNoop,
    () => window.location.hostname,
    () => ""
  )

  if (
    consent !== "granted" ||
    !isXPixelHost(hostname) ||
    !isXPixelPath(pathname)
  ) {
    return null
  }

  return (
    <Script id="x-pixel" strategy="afterInteractive">
      {X_PIXEL_SNIPPET}
    </Script>
  )
}
