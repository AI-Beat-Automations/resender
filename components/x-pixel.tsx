"use client"

import Script from "next/script"
import { usePathname } from "next/navigation"
import { useEffect, useSyncExternalStore } from "react"

import { useConsent } from "@/components/consent-provider"
import { isXPixelHost, isXPixelPath } from "@/lib/consent"
import { readXRegistration, sendXRegistration } from "@/lib/x-registration"

// `config` mide la visita; el recibo emitido por user.create.after permite
// enviar Lead una vez, también al volver de Google a una ruta privada.
//
// El id va fijo a propósito: no hay entorno de X que no sea producción, y la
// condición de «solo producción» la resuelve el hostname (ver lib/consent.ts).
// Carga con consentimiento en producción: rutas públicas o un registro
// recién completado. El recibo no contiene datos de la cuenta.
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
  const registration = useSyncExternalStore(
    subscribeNoop,
    () => readXRegistration(document.cookie),
    () => null
  )

  useEffect(() => {
    if (!registration || !isXPixelHost(hostname)) return
    if (sendXRegistration() || consent !== "granted") return
    // Also covers a persistent root layout after a server-action redirect.
    const timer = window.setInterval(() => {
      if (sendXRegistration()) window.clearInterval(timer)
    }, 250)
    const timeout = window.setTimeout(() => window.clearInterval(timer), 15_000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(timeout)
    }
  }, [consent, hostname, pathname, registration])

  if (
    consent !== "granted" ||
    !isXPixelHost(hostname) ||
    (!isXPixelPath(pathname) && !registration)
  ) {
    return null
  }

  return (
    <Script id="x-pixel" strategy="afterInteractive">
      {X_PIXEL_SNIPPET}
    </Script>
  )
}
