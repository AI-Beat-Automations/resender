// Carga e inicialización del JavaScript SDK de Facebook, **solo para el
// Embedded Signup de WhatsApp**.
//
// **Por qué acá sí y en los otros dos canales no.** Este repo sacó el SDK a
// propósito: Messenger e Instagram entran por redirección server-side —el botón
// navega a `/api/meta/start` o `/api/meta/instagram/start`, el `state` CSRF
// viaja en una cookie `httpOnly` y el `code` se canjea en el servidor—, así que
// meter un script de terceros en el layout solo habría añadido superficie y un
// tercero mirando cada página del producto (ver el comentario de `lib/meta.ts`
// y el de `connect-facebook-button.tsx`). Embedded Signup no ofrece esa opción:
// su documentación dice literalmente *"Embedded Signup relies on the JavaScript
// SDK"*, el flujo es un popup que devuelve el `code` por `postMessage` a la
// pestaña que lo abrió, y el `config_id` / `extras` que necesita no están
// documentados para el flujo de redirección manual. Sin SDK no hay tercer canal.
//
// De ahí las dos reglas de este módulo:
//
// 1. **Acotado a la pantalla, no al layout.** El `<script>` se inyecta cuando se
//    monta el launcher de Conexiones, no en `app/layout.tsx`. Quien nunca
//    conecte WhatsApp no carga nada de Facebook, y el marketing, el inbox y el
//    login siguen sin terceros.
// 2. **Una sola vez por sesión de navegador.** La promesa vive en el módulo, así
//    que dos montajes del launcher (navegar a Conexiones, volver, el doble
//    montaje de StrictMode en desarrollo) comparten la misma carga en vez de
//    apilar `<script>` y volver a llamar a `FB.init`.

import { META_GRAPH_VERSION } from "@/lib/meta/graph-version"

import type { FacebookLoginOptions } from "./signup-launch"

// URL literal del snippet oficial. **No lleva versión**: el SDK es versionless y
// se autoactualiza; lo que se versiona es `FB.init({ version })`.
const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js"

// El id histórico del snippet de Meta. Sirve para no duplicar el tag si algo más
// del documento ya lo insertó.
const SDK_SCRIPT_ID = "facebook-jssdk"

// Cuánto se espera al script antes de darlo por bloqueado. No es un timeout de
// red: es para el caso —muy frecuente y muy difícil de diagnosticar a ciegas— en
// el que un bloqueador de rastreadores se come `connect.facebook.net` sin
// disparar `onerror`, y el usuario se queda con un botón que «no hace nada».
const SDK_LOAD_TIMEOUT_MS = 15_000

// Lo poco que este módulo usa del SDK. Se declara a mano en vez de instalar
// `@types/facebook-js-sdk`: son dos métodos, y una dependencia de tipos para eso
// envejece peor que quince líneas.
export type FacebookLoginResponse = {
  authResponse?: { code?: string } | null
  status?: string
}

export type FacebookSdk = {
  init(options: {
    appId: string
    autoLogAppEvents: boolean
    xfbml: boolean
    version: string
  }): void
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: FacebookLoginOptions
  ): void
}

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

// El SDK no cargó. Se distingue de cualquier otro fallo porque la causa casi
// siempre es local (bloqueador de anuncios, escudo del navegador, DNS filtrado)
// y el mensaje que ayuda es otro.
export class FacebookSdkLoadError extends Error {
  constructor() {
    super("facebook sdk failed to load")
    this.name = "FacebookSdkLoadError"
  }
}

let loading: Promise<FacebookSdk> | null = null

export function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
  if (typeof window === "undefined") {
    return Promise.reject(new FacebookSdkLoadError())
  }
  // Ya cargado e inicializado en esta pestaña: el segundo montaje no repite nada.
  if (loading) return loading

  loading = new Promise<FacebookSdk>((resolve, reject) => {
    let settled = false

    const fail = (script: HTMLScriptElement | null) => {
      if (settled) return
      settled = true
      // Se deja el módulo listo para reintentar: el usuario puede desactivar el
      // bloqueador y recargar el launcher sin recargar la página entera.
      loading = null
      script?.remove()
      reject(new FacebookSdkLoadError())
    }

    const timer = window.setTimeout(() => {
      fail(document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null)
    }, SDK_LOAD_TIMEOUT_MS)

    // Los cuatro campos del snippet oficial, con sus valores oficiales.
    // `version` no decide gran cosa acá —en Embedded Signup el SDK no hace
    // llamadas a Graph, solo abre el popup—, pero se toma de la constante
    // compartida para que la web le hable a Meta con una sola versión.
    const initAndResolve = (sdk: FacebookSdk) => {
      sdk.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: META_GRAPH_VERSION,
      })
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(sdk)
    }

    // El SDK ya está en la página (otro script lo trajo, o este módulo se
    // reintenta tras un fallo): no hay nada que esperar.
    const present = window.FB
    if (present) {
      initAndResolve(present)
      return
    }

    // El SDK llama a `fbAsyncInit` cuando termina de cargarse, y **hay que
    // asignarlo antes de insertar el script**: si el script ganara la carrera,
    // buscaría un hook que todavía no existe y nadie inicializaría nada.
    window.fbAsyncInit = () => {
      const sdk = window.FB
      if (!sdk) {
        fail(document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null)
        return
      }
      initAndResolve(sdk)
    }

    // Si el tag ya está pero `FB` todavía no, hay una carga en vuelo: alcanza
    // con haber dejado puesto el hook de arriba.
    if (document.getElementById(SDK_SCRIPT_ID)) return

    const script = document.createElement("script")
    script.id = SDK_SCRIPT_ID
    script.src = SDK_SRC
    // `async defer crossorigin="anonymous"`, tal cual el snippet de Meta.
    script.async = true
    script.defer = true
    script.crossOrigin = "anonymous"
    script.onerror = () => fail(script)
    document.head.appendChild(script)
  })

  return loading
}
