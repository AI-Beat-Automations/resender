"use client"

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { LoaderCircle } from "lucide-react"
import { usePostHog } from "posthog-js/react"

import {
  connectWhatsappNumberAction,
  issueWhatsappSignupNonce,
  type ConnectWhatsappActionState,
} from "@/features/connect-whatsapp/actions"
import {
  loadFacebookSdk,
  type FacebookSdk,
} from "@/features/connect-whatsapp/facebook-sdk"
import {
  describeWhatsappSignupEvent,
  readWhatsappSignupEvent,
  type WhatsappSignupAssets,
} from "@/features/connect-whatsapp/signup-events"
import { decideWhatsappSubmission } from "@/features/connect-whatsapp/signup-submission"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

// Launcher del **Embedded Signup de WhatsApp**. Es el gemelo de
// `ConnectFacebookButton` y `ConnectInstagramButton`, pero es el único de los
// tres que no puede ser un enlace: Meta no ofrece flujo de redirección para
// Embedded Signup, así que esto abre un popup con el JS SDK y recoge el
// resultado por dos canales distintos (ver más abajo).
//
// El componente es a propósito un cascarón fino: lo delicado —qué `postMessage`
// se cree y cómo se clasifica— vive en `signup-events.ts`, que es un módulo puro
// con tests. Acá solo queda el cableado, que es lo que ningún test de este repo
// puede cubrir (vitest corre en node, sin jsdom ni testing-library).
//
// ---------------------------------------------------------------------------
// Cómo se juntan el `code` y los identificadores
// ---------------------------------------------------------------------------
//
// Embedded Signup devuelve el resultado por **dos canales independientes que se
// disparan en la misma finalización y sin orden garantizado**:
//
// | canal | qué trae | qué vale |
// |---|---|---|
// | callback de `FB.login` | `authResponse.code` | prueba de consentimiento, **vive 30 segundos** |
// | `postMessage` | `waba_id`, `phone_number_id` | telemetría de cliente, no autoritativa |
//
// La server action necesita los tres campos juntos, así que cada canal escribe
// en su ref (`codeRef`, `assetsRef`) y llama a `settle()`, que envía en cuanto
// están los dos y no hace nada si falta uno. No se usa estado de React para
// esto: un `setState` no es visible para el otro callback hasta el siguiente
// render, y acá el segundo canal puede llegar en el mismo tick.
//
// Se envía **en cuanto hay pareja**, sin pasar por ninguna confirmación de UI:
// el `code` caduca a los 30 segundos y un round-trip de interfaz se los come.
// Si a los pocos segundos solo llegó uno de los dos, `settle` lo dice en vez de
// dejar el botón girando: sin los dos, la conexión no puede cerrarse.
//
// ---------------------------------------------------------------------------
// Por qué el nonce se pide al montar y no en el clic
// ---------------------------------------------------------------------------
//
// `FB.login()` tiene que invocarse **de forma síncrona desde el gesto del
// usuario** o el navegador bloquea el popup ("should only be called after a user
// click event", dice Meta). Cualquier `await` antes de la llamada —incluida la
// server action que siembra la cookie del nonce— rompe la cadena del gesto y el
// clic deja de abrir nada. Por eso el nonce se pide al montar, se guarda en un
// ref y el `onClick` es puramente síncrono. El botón está deshabilitado hasta
// que el nonce y el SDK están listos, que es la otra mitad de la misma regla.

// El Configuration ID de Facebook Login for Business que define qué permisos y
// qué productos pide el flujo. Es público (viaja en la llamada del navegador),
// pero **se inlinea en tiempo de build**: si falta al compilar, no hay forma de
// rellenarlo en runtime y el botón no puede funcionar. De ahí la rama de
// «falta configuración» de abajo, y de ahí que la variable esté declarada en
// `turbo.json` y en los tres workflows.
const CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID
// La misma App ID que usa Messenger: WhatsApp vive en la misma Meta App.
const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID
const CONFIGURED = Boolean(CONFIG_ID) && Boolean(APP_ID)

// Cuánto se espera al canal que falta antes de admitir que la autorización
// volvió a medias. Es holgado para lo que tarda un `postMessage` (milisegundos)
// y corto frente a los 30 segundos que vive el `code`.
const PAIRING_TIMEOUT_MS = 4_000

// El nonce caduca a los diez minutos (`SIGNUP_NONCE_TTL_SECONDS`). Quien deja
// Conexiones abierta en una pestaña y vuelve más tarde encontraría un nonce
// muerto y un `state_mismatch` gratis, así que se renueva antes de que expire.
const NONCE_REFRESH_MS = 8 * 60 * 1_000

export function ConnectWhatsAppButton({
  label = "Conectar WhatsApp",
}: {
  label?: string
}) {
  const posthog = usePostHog()

  const [state, submit, submitting] = useActionState<
    ConnectWhatsappActionState,
    FormData
  >(connectWhatsappNumberAction, {})

  const [nonce, setNonce] = useState<string | null>(null)
  const [nonceError, setNonceError] = useState<string | null>(null)
  const [sdkReady, setSdkReady] = useState(false)
  const [sdkError, setSdkError] = useState<string | null>(null)
  // Lo que se le cuenta al usuario de lo que pasó dentro del popup. Va en
  // estado (para pintarlo) y en ref (para que los callbacks sepan si alguien ya
  // explicó el fallo con más detalle que ellos).
  const [notice, setNotice] = useState<string | null>(null)
  const noticeRef = useRef<string | null>(null)
  // El error de la acción anterior deja de pintarse en cuanto se relanza el
  // flujo: si no, alguien que reintenta se queda mirando el fallo viejo durante
  // todo el rato que pasa dentro del popup.
  const [staleActionState, setStaleActionState] = useState(false)

  const sdkRef = useRef<FacebookSdk | null>(null)
  const nonceRef = useRef<string | null>(null)
  const nonceRequestRef = useRef(0)
  // Un cierre listo que se quedó sin nonce porque justo se estaba renovando.
  const awaitingNonceRef = useRef(false)
  const settleRef = useRef<() => void>(() => {})
  // Los dos canales del onboarding, más el candado que evita enviar dos veces.
  const codeRef = useRef<string | null>(null)
  const assetsRef = useRef<WhatsappSignupAssets | null>(null)
  const submittedRef = useRef(false)
  // Cada clic abre un lanzamiento nuevo: el callback de uno viejo no puede pisar
  // al actual (pasa si alguien vuelve a pulsar con un popup ya abierto).
  const runRef = useRef(0)
  const pairingTimerRef = useRef<number | null>(null)
  const pinInputRef = useRef<HTMLInputElement>(null)
  const loggedOriginRef = useRef(false)

  const showNotice = useCallback((message: string) => {
    noticeRef.current = message
    setNotice(message)
  }, [])

  const clearPairingTimer = useCallback(() => {
    if (pairingTimerRef.current === null) return
    window.clearTimeout(pairingTimerRef.current)
    pairingTimerRef.current = null
  }, [])

  // El punto de encuentro de los dos canales. Lo llaman los dos y solo actúa
  // cuando están completos. Qué significa «completo» —y qué hacer con cada
  // combinación de lo que falta— lo decide el módulo puro `signup-submission`.
  const settle = useCallback(() => {
    const decision = decideWhatsappSubmission({
      code: codeRef.current,
      assets: assetsRef.current,
      nonce: nonceRef.current,
    })

    if (decision.kind === "await-pairing") {
      // Llegó uno solo. Se le da al otro una ventana corta y, si no aparece, se
      // dice: sin los dos no hay conexión posible, y un botón girando para
      // siempre es la peor forma de contarlo. El caso real es un `postMessage`
      // que no llega —dominio no declarado en «Allowed domains», normalmente— o
      // un popup que se cerró sin devolver el `code`.
      if (decision.started && pairingTimerRef.current === null) {
        pairingTimerRef.current = window.setTimeout(() => {
          pairingTimerRef.current = null
          if (noticeRef.current) return
          showNotice(
            "La autorización de Meta volvió incompleta y no se conectó ningún número. Vuelve a lanzarla; si se repite, escríbenos a info@resender.dev."
          )
        }, PAIRING_TIMEOUT_MS)
      }
      return
    }

    if (decision.kind === "await-nonce") {
      // La pareja está completa pero el nonce está renovándose. Se anota el
      // envío como pendiente y lo dispara `refreshNonce` al aterrizar: enviarlo
      // ahora con el nonce vacío es un `state_mismatch` garantizado, y con el
      // `code` ya gastado no hay segundo intento posible.
      clearPairingTimer()
      awaitingNonceRef.current = true
      return
    }

    clearPairingTimer()
    awaitingNonceRef.current = false
    if (submittedRef.current) return
    submittedRef.current = true

    const formData = new FormData()
    formData.set("nonce", decision.nonce)
    formData.set("code", decision.code)
    formData.set("wabaId", decision.assets.wabaId)
    formData.set("phoneNumberId", decision.assets.phoneNumberId)
    // El PIN solo existe cuando un intento anterior lo pidió (error 133005).
    const pin = pinInputRef.current?.value.trim()
    if (pin) formData.set("pin", pin)

    // Sale ya: el `code` vive 30 segundos y todo lo demás —canje, verificación
    // contra Graph, registro, suscripción y persistencia cifrada— pasa en el
    // servidor. Al navegador no vuelve ningún token.
    startTransition(() => submit(formData))
  }, [clearPairingTimer, showNotice, submit])

  // `refreshNonce` se declara antes que `settle` en el orden de las llamadas
  // pero necesita invocarlo; el ref rompe el ciclo sin recrear ninguno de los
  // dos callbacks en cada render.
  useEffect(() => {
    settleRef.current = settle
  }, [settle])

  const refreshNonce = useCallback(async () => {
    const request = ++nonceRequestRef.current
    // El nonce vigente se retira **antes** de pedir el nuevo: mientras la cookie
    // se está reemplazando, el que hay en memoria puede que ya no valga, y un
    // botón habilitado con un nonce muerto termina en un `state_mismatch` que
    // el usuario ve como «se rompió» después de haber autorizado en Meta.
    nonceRef.current = null
    setNonce(null)
    const result = await issueWhatsappSignupNonce()
    // La cookie es una sola por navegador, así que dos emisiones solapadas
    // dejan viva solo la última. Aplicar una respuesta vieja armaría el botón
    // con un nonce que ya no está en la cookie y el cierre fallaría por
    // `state_mismatch`.
    if (request !== nonceRequestRef.current) return
    nonceRef.current = result.nonce ?? null
    setNonce(result.nonce ?? null)
    setNonceError(
      result.nonce
        ? null
        : (result.error ??
            "No se pudo preparar la conexión con WhatsApp. Recarga la página e inténtalo de nuevo.")
    )

    // El cierre que se quedó esperando este nonce (ver `settle`). Si la emisión
    // falló no hay nada que enviar y el error del nonce ya se está pintando: se
    // suelta la espera para no dejar el envío colgado para siempre.
    if (awaitingNonceRef.current) {
      awaitingNonceRef.current = false
      if (result.nonce) settleRef.current()
    }
  }, [])

  // El nonce, al montar (ver la cabecera) y renovado antes de que caduque.
  useEffect(() => {
    if (!CONFIGURED) return
    void refreshNonce()
    const timer = window.setInterval(() => {
      void refreshNonce()
    }, NONCE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refreshNonce])

  // Cada intento **consume** el nonce en el servidor, salga bien o mal. Si la
  // acción devolvió estado en vez de redirigir, seguimos en esta pantalla con
  // una cookie ya gastada: hay que emitir otro antes de que el usuario reintente.
  // Se pide al terminar y no al enviar para no competir con la propia acción por
  // la cookie.
  const wasSubmittingRef = useRef(false)
  useEffect(() => {
    if (wasSubmittingRef.current && !submitting) {
      setStaleActionState(false)
      void refreshNonce()
    }
    wasSubmittingRef.current = submitting
  }, [submitting, refreshNonce])

  // El SDK de Facebook, acotado a esta pantalla (ver `facebook-sdk.ts`).
  useEffect(() => {
    if (!CONFIGURED || !APP_ID) return
    let active = true
    loadFacebookSdk(APP_ID)
      .then((sdk) => {
        if (!active) return
        sdkRef.current = sdk
        setSdkReady(true)
      })
      .catch(() => {
        if (!active) return
        setSdkError(
          "No se pudo cargar el SDK de Facebook, que es lo que abre la ventana de Meta. Suele ser un bloqueador de anuncios o de rastreadores: permítelo para este sitio y recarga la página."
        )
      })
    return () => {
      active = false
    }
  }, [])

  // El listener de `message` se monta **antes** de que exista el popup: si se
  // montara en el clic podríamos perder el primer mensaje, y además Meta usa
  // este canal también para contarnos abandonos y errores que no queremos
  // perdernos.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const signup = readWhatsappSignupEvent(event)
      if (!signup) return

      if (signup.kind === "foreign-origin") {
        // ⚠️ Meta no documenta de qué origen sale este `postMessage`, así que la
        // allowlist de `signup-events.ts` es una apuesta razonada. Se registra
        // el origen rechazado —una vez, para no dejarle a nadie un bucle de
        // consola— para poder confirmarlo con los ojos en la primera prueba
        // real. Se registra y se descarta: falla cerrado.
        if (loggedOriginRef.current) return
        loggedOriginRef.current = true
        console.warn(
          "[whatsapp] Embedded Signup: mensaje descartado por origen no permitido:",
          signup.origin
        )
        return
      }

      if (signup.kind === "finished") {
        assetsRef.current = signup.assets
        settle()
        return
      }

      // Todo lo demás terminó sin número conectado. El texto lo decide el módulo
      // puro; acá solo se pinta y se cuenta.
      const message = describeWhatsappSignupEvent(signup)
      if (message) showNotice(message)
      posthog?.capture("whatsapp signup not completed", {
        outcome: signup.kind,
        ...(signup.kind === "abandoned"
          ? { current_step: signup.currentStep }
          : {}),
        ...(signup.kind === "unsupported-flow"
          ? { finish_event: signup.event }
          : {}),
      })
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [posthog, settle, showNotice])

  useEffect(() => clearPairingTimer, [clearPairingTimer])

  // **Handler síncrono de arriba abajo.** Ni un `await`, ni un `fetch`, ni una
  // animación antes de `FB.login`: la cadena del gesto del usuario se corta con
  // cualquiera de las tres y el popup se bloquea.
  const launch = () => {
    const sdk = sdkRef.current
    if (!sdk || !CONFIG_ID || !nonceRef.current) return

    const run = ++runRef.current
    codeRef.current = null
    assetsRef.current = null
    submittedRef.current = false
    awaitingNonceRef.current = false
    noticeRef.current = null
    setNotice(null)
    setStaleActionState(true)
    clearPairingTimer()

    sdk.login(
      (response) => {
        if (run !== runRef.current) return

        const code = response?.authResponse?.code
        if (!code) {
          // Sin `authResponse` no hubo autorización. Ojo con el matiz: cerrar
          // con la X **en la última pantalla cuenta como éxito** para Meta y sí
          // devuelve el `code`, así que este camino no es «cerró la ventana» a
          // secas. Si el `postMessage` ya explicó qué pasó (un error reportado,
          // por ejemplo), ese mensaje es mejor que este y se respeta.
          if (!noticeRef.current) {
            showNotice(
              "La ventana de Meta se cerró sin completar la autorización, así que no se conectó ningún número. Si no llegaste a verla, permite las ventanas emergentes para este sitio y vuelve a intentarlo."
            )
          }
          return
        }

        codeRef.current = code
        settle()
      },
      {
        // Embedded Signup v4: los permisos y los productos viven en el
        // Configuration ID, y `extras` va vacío. Nada de `sessionInfoVersion`
        // —es de la v2, que Meta deprecia el 15 de octubre de 2026— ni de
        // `featureType`, que es lo que activaría Coexistence: este slice
        // implementa solo el flujo estándar de Cloud API.
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      }
    )
  }

  const configError = CONFIGURED
    ? null
    : "Conectar WhatsApp no está disponible en este despliegue: falta configurar NEXT_PUBLIC_WHATSAPP_CONFIG_ID. Escríbenos a info@resender.dev."

  // Un solo renglón de error, por orden de qué impide qué: sin configuración no
  // hay botón, sin SDK no hay popup, sin nonce no hay cierre, y solo después
  // vienen los desenlaces del propio flujo.
  const message =
    configError ??
    sdkError ??
    nonceError ??
    (staleActionState ? null : state.error) ??
    notice

  const disabled = !CONFIGURED || !sdkReady || !nonce || submitting

  return (
    // El id es el destino de «Reconectar» de las tarjetas de WhatsApp: no hay
    // una ruta a la que navegar —el onboarding es este popup— y no puede haber
    // dos launchers armados a la vez, porque el nonce vive en una cookie única
    // por navegador y el segundo pisaría al primero. Ver `connected-page-card`.
    <div id="conectar-whatsapp" className="flex flex-col items-start gap-2">
      <Button
        size="lg"
        variant="outline"
        onClick={launch}
        disabled={disabled}
        // Un botón deshabilitado sin explicación es indistinguible de uno roto.
        title={
          configError ??
          (sdkReady ? undefined : "Preparando la conexión con Meta…")
        }
      >
        {submitting && (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        )}
        {submitting ? "Conectando…" : label}
      </Button>

      {/* El 133005: el número ya tenía verificación en dos pasos con un PIN que
          no es el nuestro. Hay que relanzar el flujo entero —el `code` anterior
          ya se gastó—, así que el campo se queda montado y su valor viaja en el
          siguiente envío. */}
      {state.pinRequired && (
        <div className="grid w-full max-w-[320px] gap-1.5">
          <Label htmlFor="whatsapp-pin">PIN de verificación en dos pasos</Label>
          <Input
            id="whatsapp-pin"
            ref={pinInputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6 dígitos"
            className="font-mono"
          />
          <p className="text-[12px]/[1.5] text-muted-foreground">
            Escribe el PIN actual del número y vuelve a pulsar «{label}».
          </p>
        </div>
      )}

      {message && (
        <p className="max-w-[420px] text-[12.5px]/[1.5] text-[var(--danger-text)]">
          {message}
        </p>
      )}
    </div>
  )
}
