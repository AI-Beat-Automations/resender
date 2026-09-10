import { fmt, type AppDict } from "@/content/i18n/app"

import type { WhatsappOnboardingMode } from "@/lib/meta/whatsapp-client"

// Lectura, validación y clasificación de los `postMessage` del Embedded Signup
// de WhatsApp —lo que Meta llama *session logging*—.
//
// **Por qué esto no vive dentro del componente.** Es el borde no confiable del
// launcher: cualquier pestaña, iframe o extensión puede hacerle `postMessage` a
// nuestra ventana, así que este archivo es el que decide qué mensaje se cree y
// cuál se tira. El repo no tiene tests de componentes —vitest corre en node, sin
// jsdom ni testing-library— y una comprobación de seguridad sin test es una
// intención, no una garantía. Sacándola a un módulo puro que solo mira un objeto
// plano, la parte delicada queda cubierta (`signup-events.test.ts`) y el `.tsx`
// se queda con el cableado.

// **La allowlist, y por qué no seguimos el ejemplo de Meta.** Su documentación
// publica literalmente `if (!event.origin.endsWith('facebook.com')) return;`, y
// eso acepta `https://evilfacebook.com`: quien registre ese dominio puede
// inyectar un `WA_EMBEDDED_SIGNUP` falso en nuestra página y meter el `waba_id`
// que quiera en el onboarding. Comparar el origen completo contra una lista
// cerrada cuesta lo mismo y no tiene ese agujero.
//
// ⚠️ **Meta no documenta en ninguna parte el origen exacto** del que sale este
// `postMessage` (ni tabla, ni nota, en ninguna de las páginas de Embedded Signup
// ni en las de Facebook Login for Business). Estos tres son los hosts del
// diálogo de FLB y son el candidato razonable, pero **no están confirmados**.
// Por eso el mensaje que llega de un origen fuera de la lista no se descarta en
// silencio: se devuelve como `foreign-origin` para que el launcher lo registre
// en consola una vez y podamos fijar la lista con el valor observado en la
// primera prueba real. Se registra, no se acepta: falla cerrado.
//
// Defensa en profundidad, que es la que de verdad sostiene esto: los ids que
// llegan por acá **no son autoritativos**. `lib/meta/whatsapp-client.ts` los
// trata como pista y los confirma contra Graph con el token recién canjeado, así
// que un `waba_id` inyectado muere ahí aunque el origen nos engañara.
export const WHATSAPP_SIGNUP_ALLOWED_ORIGINS = [
  "https://www.facebook.com",
  "https://business.facebook.com",
  "https://web.facebook.com",
] as const

// El discriminador que Meta pone en todos sus mensajes de session logging. El
// SDK manda además otros `postMessage` que no son JSON o que no son suyos: todo
// lo que no traiga este `type` se ignora sin ruido.
export const WHATSAPP_SIGNUP_EVENT_TYPE = "WA_EMBEDDED_SIGNUP"

// Los identificadores que el navegador dice haber conectado. Pista para el
// servidor, nunca fuente de verdad (ver `lib/meta/whatsapp-client.ts`).
//
// `phoneNumberId` es `string | null` **por Coexistence**: ese flujo puede
// terminar reportando solo el `waba_id`, y el servidor sabe resolver el número
// preguntándole a Graph cuál del WABA está vinculado a la app de WhatsApp
// Business (`resolveWhatsappPhoneNumber`). En el estándar su ausencia sí es un
// fallo, y se decide acá y no allá para no gastar el `code` en un viaje que ya
// se sabe perdido.
export type WhatsappSignupAssets = {
  wabaId: string
  phoneNumberId: string | null
  businessId: string | null
}

// Un cierre completado, con **el modo derivado del propio evento**. Los dos
// viajan juntos a propósito: el modo decide la mitad irreversible entera —el
// estándar registra el número con `/register` y Coexistence no lo toca—, y
// atarlo al mismo objeto que trae los ids hace imposible enviar unos assets con
// un modo que no salió de este cierre.
export type WhatsappSignupFinish = {
  mode: WhatsappOnboardingMode
  assets: WhatsappSignupAssets
}

// Qué pasó en el popup, ya clasificado. Es una unión y no un booleano porque
// Meta mete desenlaces muy distintos en el mismo canal, y cada uno se le cuenta
// distinto a alguien que acaba de ver cerrarse una ventana:
//
// - `finished`: el camino feliz, por cualquiera de los dos flujos.
// - `finished-without-number`: terminó, pero sin número. `FINISH_ONLY_WABA`, y
//   también un `FINISH` del flujo estándar al que le falta el
//   `phone_number_id`.
// - `unsupported-flow`: terminó bien, pero por una variante que Resender no
//   sabe cerrar (una migración OBO, un grant-only, o cualquier `FINISH*` que
//   Meta agregue después). No es un fallo nuestro ni del usuario, y decir «hubo
//   un error» sería mentirle.
// - `flow-error`: `event: 'ERROR'`, el error que reporta el propio flujo.
// - `reported-error`: ⚠️ **también llega con `event: 'CANCEL'`** —es la trampa
//   de esta API— y solo se distingue del abandono por las claves de `data`.
// - `abandoned`: el usuario cerró antes de terminar; `current_step` dice dónde.
// - `malformed`: el `type` es el nuestro pero el contenido no sirve.
// - `foreign-origin`: llegó de un origen fuera de la allowlist. Ver arriba.
export type WhatsappSignupEvent =
  | ({ kind: "finished" } & WhatsappSignupFinish)
  | { kind: "finished-without-number" }
  | { kind: "unsupported-flow"; event: string }
  | { kind: "flow-error" }
  | {
      kind: "reported-error"
      errorMessage: string
      errorCode: string | null
      sessionId: string | null
    }
  | { kind: "abandoned"; currentStep: string | null }
  | { kind: "malformed" }
  | { kind: "foreign-origin"; origin: string }

// Solo lo que hace falta de un `MessageEvent`, para que el módulo no dependa del
// DOM y el test pueda pasarle un objeto plano. Un `MessageEvent` real encaja.
export type WhatsappSignupMessage = {
  isTrusted: boolean
  origin: string
  data: unknown
}

// **Qué flujo terminó de correr lo dice el evento de cierre, y nada más.**
//
// Meta ofrece las tres opciones dentro del mismo diálogo —crear una cuenta,
// «Conecta una aplicación de WhatsApp Business» y las WABAs existentes— cuando
// se manda el `featureType` (ver `signup-launch.ts`), así que el usuario elige
// adentro y el botón que lo lanzó no sabe qué eligió. Suponerlo era el error
// caro: un `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` tomado por estándar
// termina en un `POST /{phone_number_id}/register`, que desvincula de la app de
// WhatsApp Business el número que el cliente quería seguir usando ahí, y eso no
// se deshace desde acá.
//
// Por eso esto es un mapa evento → modo y no una comparación contra el modo
// lanzado: acá se **deriva**, no se valida.
const MODE_BY_FINISH_EVENT: Record<string, WhatsappOnboardingMode> = {
  FINISH: "standard",
  FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING: "coexistence",
}

/**
 * El modo que corresponde a un evento de cierre, o `null` si ese `FINISH*` no
 * es ninguno de los dos que sabemos terminar. Exportado porque es **la** regla
 * de la que depende que un número de Coexistence no pase nunca por `/register`.
 */
export function resolveWhatsappOnboardingMode(
  event: string
): WhatsappOnboardingMode | null {
  return MODE_BY_FINISH_EVENT[event] ?? null
}

const FINISH_WITHOUT_NUMBER_EVENT = "FINISH_ONLY_WABA"

export function readWhatsappSignupEvent(
  message: WhatsappSignupMessage
): WhatsappSignupEvent | null {
  // `isTrusted` es `false` en cualquier evento que haya despachado un script de
  // la página (`window.dispatchEvent(new MessageEvent(...))`). No para a un
  // atacante con su propia ventana —esos son `isTrusted: true`—, pero sí cierra
  // el camino más barato: una extensión o un script inyectado en nuestro propio
  // documento fabricando el mensaje sin salir de él.
  if (!message.isTrusted) return null

  const payload = parsePayload(message.data)
  if (!payload) return null

  // El `type` antes que nada: el SDK y los iframes de Facebook mandan bastante
  // tráfico por este canal, y lo que no dice ser nuestro no se mira más.
  if (payload.type !== WHATSAPP_SIGNUP_EVENT_TYPE) return null

  const event = readText(payload, "event")
  if (!event) return null

  // El origen se comprueba **después** del `type` a propósito: así solo se
  // reporta el origen de mensajes que dicen ser de Embedded Signup, y el aviso
  // de QA no se ahoga entre el ruido de widgets y extensiones.
  if (!isAllowedOrigin(message.origin)) {
    return { kind: "foreign-origin", origin: message.origin }
  }

  const data = isRecord(payload.data) ? payload.data : {}

  if (event === "CANCEL") {
    // Dos desenlaces con la misma etiqueta. El discriminador es `error_message`:
    // si está, el usuario reportó un error desde el propio flujo; si no, cerró.
    const errorMessage = readText(data, "error_message")
    if (errorMessage) {
      return {
        kind: "reported-error",
        errorMessage: truncate(errorMessage),
        errorCode: readText(data, "error_code"),
        sessionId: readText(data, "session_id"),
      }
    }
    return { kind: "abandoned", currentStep: readText(data, "current_step") }
  }

  if (event === "ERROR") return { kind: "flow-error" }

  // El modo sale de acá y de ningún otro lado (ver `MODE_BY_FINISH_EVENT`).
  const mode = resolveWhatsappOnboardingMode(event)
  if (mode) {
    const wabaId = readText(data, "waba_id")
    // Sin `waba_id` no hay nada que confirmar contra Graph: el servidor lo
    // rechazaría igual, y decirlo acá ahorra un viaje y un `code` quemado.
    if (!wabaId) return { kind: "malformed" }

    const phoneNumberId = readText(data, "phone_number_id")
    // Un `FINISH` estándar sin número es, en la práctica, un
    // `FINISH_ONLY_WABA`: el usuario saltó el alta del teléfono. En Coexistence
    // no: ahí el número existe desde antes —está en la app de WhatsApp
    // Business— y Graph sabe cuál es, así que la falta de pista no cancela nada.
    if (!phoneNumberId && mode === "standard") {
      return { kind: "finished-without-number" }
    }

    return {
      kind: "finished",
      mode,
      assets: {
        wabaId,
        phoneNumberId,
        businessId: readText(data, "business_id"),
      },
    }
  }

  if (event === FINISH_WITHOUT_NUMBER_EVENT) {
    return { kind: "finished-without-number" }
  }

  // `FINISH_OBO_MIGRATION`, `FINISH_GRANT_ONLY_API_ACCESS` y cualquiera que
  // Meta agregue después. Se reconocen por prefijo para que un valor nuevo
  // llegue como «terminaste por una variante que no soportamos» —que es la
  // verdad— y no como un mensaje ignorado que deja el botón girando. **No se
  // deriva ningún modo de un `FINISH*` desconocido**: registrar un número
  // adivinando el flujo es justo lo que no puede pasar.
  if (event.startsWith("FINISH")) return { kind: "unsupported-flow", event }

  // Meta documenta que no hay eventos de progreso. Un `event` desconocido que ni
  // siquiera es `FINISH*` no significa nada para nosotros.
  return null
}

// Cómo se le cuenta cada desenlace a alguien que acaba de ver cerrarse la
// ventana de Meta y no sabe qué pasó. `null` en los dos casos que no son un
// mensaje para el usuario: el éxito lo resuelve el envío al servidor, y el
// origen ajeno es una nota de diagnóstico, no algo que la pantalla deba decir.
export function describeWhatsappSignupEvent(
  event: WhatsappSignupEvent,
  t: AppDict
): string | null {
  const e = t.whatsappEvents

  switch (event.kind) {
    case "finished":
    case "foreign-origin":
      return null

    case "finished-without-number":
      return e.finishedWithoutNumber

    case "unsupported-flow":
      return describeUnsupportedFlow(event.event, t)

    case "flow-error":
      return e.flowError

    case "reported-error": {
      // El texto es el que Meta le mostró al usuario dentro del flujo: es lo más
      // accionable que hay, y viene de un origen ya validado. El código y la
      // sesión no son para nosotros —no son estables ni sirven para ramificar—,
      // son lo que Meta pide citar si el cliente escribe a soporte.
      const reference = [
        event.errorCode
          ? fmt(e.reportedErrorCode, { code: event.errorCode })
          : null,
        event.sessionId
          ? fmt(e.reportedErrorSession, { id: event.sessionId })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
      const suffix = reference ? fmt(e.reportedErrorSuffix, { reference }) : ""
      return fmt(e.reportedError, { message: event.errorMessage, suffix })
    }

    case "abandoned": {
      const step = event.currentStep ? e.steps[event.currentStep] : null
      const where = step ? fmt(e.abandonedWhere, { step }) : ""
      return fmt(e.abandoned, { where })
    }

    case "malformed":
      return e.malformed
  }
}

// Los `FINISH*` que Resender no sabe cerrar. Cada uno dice **qué** completó el
// usuario y por qué ese resultado no conecta nada: terminó bien, no falló nada,
// y un «hubo un error» acá sería mentirle y mandarlo a reintentar en bucle.
//
// Los dos cierres que sí soportamos —`FINISH` y
// `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`— ya no pasan por acá: los dos son
// resultados válidos del único botón, y cuál de los dos fue es justamente lo que
// deriva el modo.
function describeUnsupportedFlow(event: string, t: AppDict): string {
  switch (event) {
    case "FINISH_OBO_MIGRATION":
      return t.whatsappEvents.unsupportedMigration
    case "FINISH_GRANT_ONLY_API_ACCESS":
      return t.whatsappEvents.unsupportedGrantOnly
    default:
      return fmt(t.whatsappEvents.unsupportedOther, {
        event: truncate(event, 60),
      })
  }
}

// En qué pantalla estaba el usuario cuando cerró: los `current_step` de Meta
// traducidos a la voz de la pantalla, en `t.whatsappEvents.steps`. Es el único
// `Record` del diccionario con clave abierta —las claves son de Meta, no
// nuestras—, así que un valor nuevo cae en `undefined` y el mensaje omite el
// «te quedaste en…», que es preferible a decir `PHONE_NUMBER_SETUP`.

function isAllowedOrigin(origin: string): boolean {
  return (WHATSAPP_SIGNUP_ALLOWED_ORIGINS as readonly string[]).includes(origin)
}

// Meta documenta que `event.data` llega como **string JSON**. Se acepta también
// un objeto ya deserializado porque no cuesta nada y porque el día que el SDK
// cambie a mandar objetos —o alguien lo envuelva— el flujo no se rompería en
// silencio; la seguridad no depende de esto, sino del origen y del servidor.
function parsePayload(data: unknown): Record<string, unknown> | null {
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data)
      return isRecord(parsed) ? parsed : null
    } catch {
      // Por este canal pasan mensajes que no son JSON. No es un error.
      return null
    }
  }
  return isRecord(data) ? data : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Lee un campo como texto. Acepta números porque los ids de Meta viajan como
// string en los ejemplos, pero un JSON con `waba_id: 524126980791429` no sería
// ilegal y perderlo por el tipo sería un fallo tonto.
function readText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// Nada de lo que venga del popup se pinta en pantalla a su antojo: React escapa
// el contenido, así que el riesgo no es inyección sino un texto larguísimo que
// rompa el layout de un aviso.
function truncate(value: string, max = 240): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}
