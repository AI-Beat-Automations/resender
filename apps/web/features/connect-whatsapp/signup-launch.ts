import type { WhatsappOnboardingMode } from "@/lib/meta/whatsapp-client"

// Los dos puntos de entrada del Embedded Signup y las opciones exactas con las
// que se le habla a `FB.login`.
//
// Módulo puro y separado del `.tsx` por la regla de siempre en este repo: los
// tests no corren componentes, así que lo que se escriba dentro del botón es
// una regla sin red. Y acá lo que hay que fijar con un test es justo lo que un
// `.tsx` esconde bien: que el flujo estándar y el de Coexistence **no** salen
// con las mismas opciones, porque de eso depende que Meta abra un diálogo o el
// otro y, más abajo, que el número se registre con `/register` o no.

// ---------------------------------------------------------------------------
// ⚠️ `sessionInfoVersion` — DECISIÓN QUE UN HUMANO TIENE QUE VERIFICAR
// ---------------------------------------------------------------------------
//
// El PRD lo pide («`sessionInfoVersion` vigente») y exige **session logging**,
// que además es requisito formal de Coexistence. Una rama anterior lo omitía
// argumentando que es de Embedded Signup v2 y que Meta lo deprecia el
// 2026-10-15.
//
// Se manda, por tres razones:
//
// 1. Todo `signup-events.ts` —los `postMessage` `WA_EMBEDDED_SIGNUP` con
//    `FINISH`, `CANCEL`, `current_step`, `error_message`— **es** el session
//    logging. Sin él el launcher no tiene cómo saber qué WABA se conectó ni por
//    qué el usuario cerró, y el flujo se queda con un solo canal (el `code`).
// 2. Coexistence lo exige, y este slice implementa Coexistence.
// 3. El coste de mandarlo de más es una clave ignorada en `extras`; el de
//    omitirlo de menos es un onboarding de Coexistence que Meta puede rechazar y
//    un popup que no reporta nada.
//
// **Verificar contra la documentación viva antes del primer onboarding real**:
// el valor correcto de `sessionInfoVersion` (hoy `"3"`), y si la deprecación
// del 2026-10-15 aplica a la clave entera o solo a la versión 2. Si aplica a la
// clave, se borra esta constante y nada más: no hay ninguna otra rama que
// dependa de ella.
export const WHATSAPP_SESSION_INFO_VERSION = "3"

// ⚠️ **También a verificar**: el `featureType` con el que Meta abre el
// onboarding de Coexistence. `whatsapp_business_app_onboarding` es el valor
// documentado para «Business App onboarding», que es el nombre oficial del
// flujo B del PRD. Si Meta lo renombra, el diálogo abre el flujo estándar sin
// avisar y el usuario termina registrando —y desvinculando de la app— el número
// que quería compartir. Por eso `signup-events.ts` rechaza el `FINISH` estándar
// cuando el modo es Coexistence: es la red que atrapa exactamente ese error.
export const WHATSAPP_COEXISTENCE_FEATURE_TYPE =
  "whatsapp_business_app_onboarding"

export type FacebookLoginExtras = {
  setup: Record<string, never>
  sessionInfoVersion: string
  featureType?: string
}

export type FacebookLoginOptions = {
  config_id: string
  response_type: "code"
  override_default_response_type: true
  extras: FacebookLoginExtras
}

export type WhatsappSignupConfig = {
  // El Configuration ID de Facebook Login for Business del flujo estándar.
  configId: string | null
  // El de Coexistence, si el despliegue tiene uno aparte. `null` significa «el
  // mismo, distinguido por `featureType`», que es la forma soportada cuando
  // Meta no obliga a dos configuraciones.
  coexistenceConfigId: string | null
}

export function resolveWhatsappConfigId(
  config: WhatsappSignupConfig,
  mode: WhatsappOnboardingMode
): string | null {
  if (mode === "coexistence") {
    return config.coexistenceConfigId ?? config.configId
  }
  return config.configId
}

// Las opciones de `FB.login`. `override_default_response_type` es lo que hace
// que Meta devuelva un `code` canjeable por el servidor en vez de un token en el
// navegador: sin él, `FB.login` entrega un access token al cliente, que es
// exactamente lo que este flujo no puede permitirse.
export function buildFacebookLoginOptions(
  configId: string,
  mode: WhatsappOnboardingMode
): FacebookLoginOptions {
  return {
    config_id: configId,
    response_type: "code",
    override_default_response_type: true,
    extras: {
      // Vacío a propósito: los permisos y los productos viven en el
      // Configuration ID, no acá. Prellenar datos del negocio es una función
      // aparte que este flujo no usa.
      setup: {},
      sessionInfoVersion: WHATSAPP_SESSION_INFO_VERSION,
      ...(mode === "coexistence"
        ? { featureType: WHATSAPP_COEXISTENCE_FEATURE_TYPE }
        : {}),
    },
  }
}

// El copy de los dos puntos de entrada. Son dos botones y no uno con un
// desplegable porque la elección no es una preferencia: elegir mal el flujo
// estándar sobre un número que sigue en la app de WhatsApp Business lo
// desvincula de la app, y eso no se deshace desde acá.
export type WhatsappEntryPoint = {
  mode: WhatsappOnboardingMode
  label: string
  // Qué es este flujo, en la voz de la pantalla y sin jerga de Meta.
  description: string
  // La consecuencia que hay que decir **antes**, no después.
  caveat: string
}

export const WHATSAPP_ENTRY_POINTS: readonly WhatsappEntryPoint[] = [
  {
    mode: "standard",
    label: "Conectar un número nuevo",
    description:
      "Para un número que todavía no usas en la app de WhatsApp Business: lo damos de alta en la API de WhatsApp y las conversaciones entran y salen por Resender.",
    caveat:
      "Ese número queda registrado para la API y deja de poder usarse desde la app de WhatsApp Business.",
  },
  {
    mode: "coexistence",
    label: "Conectar un número existente",
    description:
      "Para el número que ya usas a diario en la app de WhatsApp Business: sigue funcionando ahí y además llega a Resender, con el historial que elijas compartir.",
    caveat:
      "Meta decide la elegibilidad y el número queda con un techo fijo de 20 mensajes por segundo. El historial hay que sincronizarlo dentro de las 24 horas siguientes a conectarlo.",
  },
] as const

// El modo que pide el enlace de entrada (`/api/meta/whatsapp/start?mode=…`) y
// el que reenvía el cierre al servidor. **Todo lo que no sea exactamente
// `coexistence` es el flujo estándar**, y no un error: un parámetro perdido o
// tocado a mano tiene que caer en el flujo que no depende de que Meta habilite
// nada, no en el que sí.
//
// La dirección de la caída se elige así y no al revés a propósito. Parece lo
// contrario de «fail closed», pero no lo es: los dos flujos están detrás de los
// mismos gates, y el daño de tratar Coexistence como estándar lo atrapa
// `signup-events.ts` —el `FINISH` del flujo equivocado se rechaza— antes de que
// llegue a `/register`.
export function parseWhatsappMode(value: unknown): WhatsappOnboardingMode {
  return value === "coexistence" ? "coexistence" : "standard"
}
