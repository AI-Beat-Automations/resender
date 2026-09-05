"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LoaderCircle, Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"

import { issueWhatsappSignupNonce } from "@/features/connect-whatsapp/actions"
import {
  loadFacebookSdk,
  type FacebookSdk,
} from "@/features/connect-whatsapp/facebook-sdk"
import { buildFacebookLoginOptions } from "@/features/connect-whatsapp/signup-launch"
import {
  describeWhatsappSignupEvent,
  readWhatsappSignupEvent,
  type WhatsappSignupFinish,
} from "@/features/connect-whatsapp/signup-events"
import { decideWhatsappSubmission } from "@/features/connect-whatsapp/signup-submission"
import { useAppDict } from "@/content/i18n/app/provider"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"

// Launcher del **Embedded Signup de WhatsApp**. Es el gemelo de
// `ConnectFacebookButton` y `ConnectInstagramButton`, pero es el único de los
// tres que no puede ser un enlace: Meta no ofrece flujo de redirección para
// Embedded Signup, así que esto abre un popup con el JS SDK y recoge el
// resultado por dos canales distintos (ver más abajo).
//
// El componente es a propósito un cascarón fino: lo delicado —qué `postMessage`
// se cree, con qué opciones se lanza cada flujo, cuándo se puede enviar— vive en
// `signup-events.ts`, `signup-launch.ts` y `signup-submission.ts`, que son
// módulos puros con tests. Acá solo queda el cableado, que es lo que ningún test
// de este repo puede cubrir (vitest corre en node, sin jsdom ni
// testing-library).
//
// **Un solo botón, y la elección adentro del diálogo.** Hubo dos botones
// —«número nuevo» y «número existente»— hasta que se verificó contra el diálogo
// real que el `featureType` es **aditivo**: con él puesto, el desplegable de
// Meta ofrece las tres opciones (cuenta nueva, «Conecta una aplicación de
// WhatsApp Business» y las WABAs del portafolio). Dos botones prometían una
// elección que en realidad se hacía adentro, y peor: persistían el
// `onboarding_mode` según cuál se hubiera pulsado, que es una suposición sobre
// algo que el usuario podía cambiar en la ventana siguiente. Ahora el modo lo
// **deriva el evento de cierre** (`signup-events.ts`) y este componente no
// opina.
//
// Tampoco puede haber dos launchers montados a la vez: el nonce vive en una
// cookie única por navegador y el segundo pisaría al primero.
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
// El cierre necesita los tres campos juntos, así que cada canal escribe en su
// ref (`codeRef`, `assetsRef`) y llama a `settle()`, que envía en cuanto están
// los dos y no hace nada si falta uno. No se usa estado de React para esto: un
// `setState` no es visible para el otro callback hasta el siguiente render, y
// acá el segundo canal puede llegar en el mismo tick.
//
// Se envía **en cuanto hay pareja**, sin pasar por ninguna confirmación de UI:
// el `code` caduca a los 30 segundos y un round-trip de interfaz se los come.
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
// que el nonce y el SDK están listos, que es la otra mitad de la regla.

// El Configuration ID de Facebook Login for Business que define qué permisos y
// qué productos pide el flujo. Es público (viaja en la llamada del navegador),
// pero **se inlinea en tiempo de build**: si falta al compilar, no hay forma de
// rellenarlo en runtime y el botón no puede funcionar. De ahí la rama de «falta
// configuración» de abajo.
//
// **Uno solo para los dos flujos**: la diferencia entre el alta estándar y
// Coexistence no vive en la configuración de Facebook Login for Business sino
// en lo que el usuario elige dentro del diálogo de Meta.
const CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID ?? null
// La misma App ID que usa Messenger: WhatsApp vive en la misma Meta App.
const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? null
const CONFIGURED = Boolean(CONFIG_ID) && Boolean(APP_ID)

// Cuánto se espera al canal que falta antes de admitir que la autorización
// volvió a medias. Es holgado para lo que tarda un `postMessage`
// (milisegundos) y corto frente a los 30 segundos que vive el `code`.
const PAIRING_TIMEOUT_MS = 4_000

// El nonce caduca a los diez minutos (`SIGNUP_NONCE_TTL_SECONDS`). Quien deja
// Conexiones abierta en una pestaña y vuelve más tarde encontraría un nonce
// muerto y un `state_mismatch` gratis, así que se renueva antes de que expire.
const NONCE_REFRESH_MS = 8 * 60 * 1_000

export function ConnectWhatsAppButton({
  variant = "default",
  size = "lg",
  icon = false,
  compact = false,
}: {
  // Solo piel (ADR 0015): el flujo del Embedded Signup no cambia con la forma.
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  icon?: boolean
  // En el hueco de acciones del header no hay sitio para la descripción ni
  // para los avisos: la descripción queda solo para lectores de pantalla y lo
  // que pasa dentro del popup se cuelga debajo del botón, sin empujar el header.
  compact?: boolean
}) {
  const posthog = usePostHog()
  const router = useRouter()

  const [nonce, setNonce] = useState<string | null>(null)
  const [nonceError, setNonceError] = useState<string | null>(null)
  const [sdkReady, setSdkReady] = useState(false)
  const [sdkError, setSdkError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pinRequired, setPinRequired] = useState(false)
  // Lo que se le cuenta al usuario de lo que pasó dentro del popup. Va en
  // estado (para pintarlo) y en ref (para que los callbacks sepan si alguien ya
  // explicó el fallo con más detalle que ellos).
  const [notice, setNotice] = useState<string | null>(null)
  const noticeRef = useRef<string | null>(null)
  // La consecuencia concreta del flujo que el usuario **eligió de verdad**.
  // Antes del clic no se puede saber cuál de las dos es, así que se dice al
  // cerrarse la ventana y no en la descripción del botón.
  const [modeCaveat, setModeCaveat] = useState<string | null>(null)
  const t = useAppDict()
  // El diccionario en un ref: los callbacks de abajo lo leen desde `useCallback`
  // y desde el listener de `message`, y meterlo en las dependencias volvería a
  // crear el listener —y a reemitir el nonce— en cada render.
  const dictRef = useRef(t)
  // Se sincroniza en un efecto y no durante el render: escribir un ref mientras
  // se renderiza es lo que prohíbe `react-hooks/refs`. No hay carrera —los
  // callbacks que lo leen corren por interacción del usuario, siempre después
  // del montaje— y el valor inicial ya lo pone el `useRef`.
  useEffect(() => {
    dictRef.current = t
  }, [t])

  const sdkRef = useRef<FacebookSdk | null>(null)
  const nonceRef = useRef<string | null>(null)
  const nonceRequestRef = useRef(0)
  // Un cierre listo que se quedó sin nonce porque justo se estaba renovando.
  const awaitingNonceRef = useRef(false)
  const settleRef = useRef<() => void>(() => {})
  // Los dos canales del onboarding, más el candado que evita enviar dos veces.
  // El cierre trae los ids **y el modo derivado del evento**, atados: no hay un
  // `modeRef` aparte porque un modo que pudiera fijarse fuera de este objeto
  // sería un modo que no salió del `FINISH*` que lo produjo.
  const codeRef = useRef<string | null>(null)
  const finishRef = useRef<WhatsappSignupFinish | null>(null)
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
    // con un nonce que ya no está en la cookie.
    if (request !== nonceRequestRef.current) return
    nonceRef.current = result.nonce ?? null
    setNonce(result.nonce ?? null)
    setNonceError(
      result.nonce
        ? null
        : (result.error ?? dictRef.current.whatsappSignup.nonceFailed)
    )

    // El cierre que se quedó esperando este nonce (ver `settle`). Si la emisión
    // falló no hay nada que enviar y el error del nonce ya se está pintando: se
    // suelta la espera para no dejar el envío colgado para siempre.
    if (awaitingNonceRef.current) {
      awaitingNonceRef.current = false
      if (result.nonce) settleRef.current()
    }
  }, [])

  // El envío al servidor. **Nada de tokens acá**: van el `code`, los
  // identificadores, el modo y el nonce, y vuelve una URL o un error.
  const submit = useCallback(
    async (payload: Record<string, string>) => {
      setSubmitting(true)
      setActionError(null)
      try {
        const response = await fetch("/api/meta/whatsapp/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        const result = (await response.json()) as {
          ok?: boolean
          redirectTo?: string
          error?: string
          pinRequired?: boolean
        }

        if (result.ok && result.redirectTo) {
          router.push(result.redirectTo)
          router.refresh()
          return
        }

        setPinRequired(result.pinRequired === true)
        setActionError(
          result.error ?? dictRef.current.whatsappSignup.submitFailed
        )
      } catch {
        setActionError(dictRef.current.whatsappSignup.networkFailed)
      } finally {
        setSubmitting(false)
        // Cada intento **consume** el nonce en el servidor, salga bien o mal:
        // hay que emitir otro antes de que el usuario reintente.
        void refreshNonce()
      }
    },
    [refreshNonce, router]
  )

  // El punto de encuentro de los dos canales. Lo llaman los dos y solo actúa
  // cuando están completos. Qué significa «completo» —y qué hacer con cada
  // combinación de lo que falta— lo decide el módulo puro `signup-submission`.
  const settle = useCallback(() => {
    const decision = decideWhatsappSubmission({
      code: codeRef.current,
      finish: finishRef.current,
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
          showNotice(dictRef.current.whatsappSignup.pairingIncomplete)
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

    const pin = pinInputRef.current?.value.trim()
    void submit({
      nonce: decision.nonce,
      code: decision.code,
      wabaId: decision.assets.wabaId,
      mode: decision.mode,
      // Coexistence puede cerrar sin número: el servidor lo resuelve contra
      // Graph, así que la clave se omite en vez de mandarse vacía.
      ...(decision.assets.phoneNumberId
        ? { phoneNumberId: decision.assets.phoneNumberId }
        : {}),
      // El PIN solo existe cuando un intento anterior lo pidió (error 133005).
      ...(pin ? { pin } : {}),
    })
  }, [clearPairingTimer, showNotice, submit])

  // `refreshNonce` se declara antes que `settle` en el orden de las llamadas
  // pero necesita invocarlo; el ref rompe el ciclo sin recrear ninguno de los
  // dos callbacks en cada render.
  useEffect(() => {
    settleRef.current = settle
  }, [settle])

  // El nonce, al montar (ver la cabecera) y renovado antes de que caduque.
  //
  // `react-hooks/set-state-in-effect` pide mover el `setState` al evento que lo
  // origina, y acá no se puede: el origen es el clic, y pedir el nonce dentro
  // del `onClick` mete un `await` antes de `FB.login` que rompe la cadena del
  // gesto y hace que el navegador bloquee el popup. El nonce tiene que estar en
  // memoria **antes** del clic, así que sincronizarlo con el servidor es
  // justamente lo que este efecto existe para hacer.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!CONFIGURED) return
    void refreshNonce()
    const timer = window.setInterval(() => {
      void refreshNonce()
    }, NONCE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refreshNonce])
  /* eslint-enable react-hooks/set-state-in-effect */

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
        setSdkError(dictRef.current.whatsappSignup.sdkBlocked)
      })
    return () => {
      active = false
    }
  }, [])

  // El listener de `message` se monta **antes** de que exista el popup: si se
  // montara en el clic podríamos perder el primer mensaje, y además Meta usa
  // este canal también para contarnos abandonos y errores que no queremos
  // perdernos. Es el *session logging* del que habla la documentación.
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
        finishRef.current = { mode: signup.mode, assets: signup.assets }
        // Recién acá se sabe qué eligió el usuario dentro del diálogo, así que
        // recién acá se le puede decir qué implica: el número queda registrado y
        // deja de abrir en la app, o hay techo de 20 mps y reloj de 24 h.
        setModeCaveat(
          dictRef.current.connections.whatsappModeCaveat[signup.mode]
        )
        settle()
        return
      }

      // Todo lo demás terminó sin número conectado. El texto lo decide el módulo
      // puro; acá solo se pinta y se cuenta.
      const message = describeWhatsappSignupEvent(signup, dictRef.current)
      if (message) showNotice(message)
      // Sin `mode`: un cierre que no completó no eligió flujo, y mandar el del
      // botón sería inventar justo el dato que este cambio dejó de inventar.
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
    finishRef.current = null
    submittedRef.current = false
    awaitingNonceRef.current = false
    noticeRef.current = null
    setNotice(null)
    setActionError(null)
    setModeCaveat(null)
    clearPairingTimer()

    sdk.login((response) => {
      if (run !== runRef.current) return

      const code = response?.authResponse?.code
      if (!code) {
        // Sin `authResponse` no hubo autorización. Ojo con el matiz: cerrar
        // con la X **en la última pantalla cuenta como éxito** para Meta y sí
        // devuelve el `code`, así que este camino no es «cerró la ventana» a
        // secas. Si el `postMessage` ya explicó qué pasó (un error reportado,
        // por ejemplo), ese mensaje es mejor que este y se respeta.
        if (!noticeRef.current) {
          showNotice(dictRef.current.whatsappSignup.popupClosed)
        }
        return
      }

      codeRef.current = code
      settle()
    }, buildFacebookLoginOptions(CONFIG_ID))
  }

  const configError = CONFIGURED ? null : t.whatsappSignup.notConfigured

  // Un solo renglón de error, por orden de qué impide qué: sin configuración no
  // hay botón, sin SDK no hay popup, sin nonce no hay cierre, y solo después
  // vienen los desenlaces del propio flujo.
  const message = configError ?? sdkError ?? nonceError ?? actionError ?? notice

  const disabled = !CONFIGURED || !sdkReady || !nonce || submitting

  return (
    // El id es el destino de «Reconectar» de las tarjetas de WhatsApp y del
    // redirect de `/api/meta/whatsapp/start`: no hay una ruta a la que navegar
    // —el onboarding es este popup— y no puede haber dos launchers armados a la
    // vez, porque el nonce vive en una cookie única por navegador y el segundo
    // pisaría al primero.
    <div
      id="conectar-whatsapp"
      className={cn(
        "flex flex-col items-start gap-4",
        compact && "relative gap-0"
      )}
    >
      <div className="flex flex-col items-start gap-1.5">
        <Button
          size={size}
          variant={variant}
          onClick={launch}
          disabled={disabled}
          // Un botón deshabilitado sin explicación es indistinguible de uno
          // roto.
          title={
            configError ?? (sdkReady ? undefined : t.whatsappSignup.preparing)
          }
          aria-describedby="whatsapp-entry-description"
        >
          {submitting ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            icon && <Plus aria-hidden />
          )}
          {submitting ? t.whatsappSignup.connecting : t.whatsappSignup.connect}
        </Button>
        <p
          id="whatsapp-entry-description"
          className={cn(
            "max-w-[420px] text-[12.5px]/[1.5] text-muted-foreground",
            compact && "sr-only"
          )}
        >
          {t.whatsappSignup.description}
        </p>
      </div>

      {/* Lo que pasó dentro del popup y el PIN del 133005. En modo compacto se
          descuelgan bajo el botón como un panel flotante, alineado a la
          derecha, para no romper la altura fija del header. */}
      {(modeCaveat || pinRequired || message) && (
        <div
          className={cn(
            "flex flex-col items-start gap-4",
            compact &&
              "absolute top-full right-0 z-20 mt-2 w-[380px] max-w-[calc(100vw-3rem)] rounded-xl bg-popover p-3.5 text-left ring-1 ring-foreground/10"
          )}
        >
          {/* La consecuencia concreta, ya con el modo real en la mano. Es la
              mitad que antes vivía en la descripción de cada botón y que con un
              solo punto de entrada no se puede decir de antemano sin confundir:
              hasta que la ventana no se cierra, no se sabe cuál de las dos toca. */}
          {modeCaveat && (
            <p className="max-w-[420px] text-[12.5px]/[1.5] text-foreground">
              {modeCaveat}
            </p>
          )}

          {/* El 133005: el número ya tenía verificación en dos pasos con un PIN
              que no es el nuestro. Hay que relanzar el flujo entero —el `code`
              anterior ya se gastó—, así que el campo se queda montado y su
              valor viaja en el siguiente envío. */}
          {pinRequired && (
            <div className="grid w-full max-w-[320px] gap-1.5">
              <Label htmlFor="whatsapp-pin">{t.whatsappSignup.pinLabel}</Label>
              <Input
                id="whatsapp-pin"
                ref={pinInputRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder={t.whatsappSignup.pinPlaceholder}
                className="font-mono"
              />
              <p className="text-[12px]/[1.5] text-muted-foreground">
                {t.whatsappSignup.pinHint}
              </p>
            </div>
          )}

          {message && (
            <Alert variant="destructive" className="max-w-[420px]">
              <AlertTitle className="text-[12.5px]/[1.5] font-normal">
                {message}
              </AlertTitle>
            </Alert>
          )}
        </div>
      )}
    </div>
  )
}
