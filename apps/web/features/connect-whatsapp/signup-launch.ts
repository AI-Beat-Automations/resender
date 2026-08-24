import type { WhatsappOnboardingMode } from "@/lib/meta/whatsapp-client"

// El único punto de entrada del Embedded Signup y las opciones exactas con las
// que se le habla a `FB.login`.
//
// Módulo puro y separado del `.tsx` por la regla de siempre en este repo: los
// tests no corren componentes, así que lo que se escriba dentro del botón es
// una regla sin red. Y acá lo que hay que fijar con un test es justo lo que un
// `.tsx` esconde bien: con qué `extras` sale el popup, porque de eso depende
// qué opciones le ofrece Meta al usuario dentro del diálogo.

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
//    logging. Sin él el launcher no tiene cómo saber qué WABA se conectó, por
//    cuál de los dos flujos terminó ni por qué el usuario cerró, y el flujo se
//    queda con un solo canal (el `code`).
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

// El `featureType` con el que Meta abre el diálogo. **Va siempre**, y eso no es
// un descuido: se verificó contra el diálogo real que este valor es
// **aditivo**, no restrictivo. Con él puesto, el desplegable «Cuenta de
// WhatsApp Business» ofrece las tres opciones —crear una cuenta nueva,
// «Conecta una aplicación de WhatsApp Business» (Coexistence) y las WABAs que
// el portafolio ya tiene—. Sin él, la opción de Coexistence no aparece.
//
// Por eso hay un solo botón: quien elige el flujo es el usuario, dentro del
// diálogo de Meta, y no nosotros al armar las opciones. Qué eligió lo dice el
// evento de cierre y lo deriva `signup-events.ts`; suponerlo desde el botón era
// exactamente el error que podía terminar registrando con `/register` un número
// que el cliente quería seguir usando desde la app.
//
// ⚠️ **A verificar contra la documentación viva**:
// `whatsapp_business_app_onboarding` es el valor documentado para «Business App
// onboarding». Si Meta lo renombra, el diálogo deja de ofrecer Coexistence —el
// desplegable se queda con las otras dos opciones— y el usuario no puede
// conectar el número que ya usa. No hay riesgo de registrar de más: el modo sale
// del evento de cierre, así que un `featureType` muerto degrada el menú, no la
// decisión.
export const WHATSAPP_SIGNUP_FEATURE_TYPE = "whatsapp_business_app_onboarding"

export type FacebookLoginExtras = {
  setup: Record<string, never>
  sessionInfoVersion: string
  featureType: string
}

export type FacebookLoginOptions = {
  config_id: string
  response_type: "code"
  override_default_response_type: true
  extras: FacebookLoginExtras
}

// Las opciones de `FB.login`. `override_default_response_type` es lo que hace
// que Meta devuelva un `code` canjeable por el servidor en vez de un token en el
// navegador: sin él, `FB.login` entrega un access token al cliente, que es
// exactamente lo que este flujo no puede permitirse.
//
// Un solo Configuration ID para los dos flujos: la diferencia entre estándar y
// Coexistence no está en la configuración de Facebook Login for Business sino
// en lo que el usuario elige adentro del diálogo.
export function buildFacebookLoginOptions(
  configId: string
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
      featureType: WHATSAPP_SIGNUP_FEATURE_TYPE,
    },
  }
}

// El copy del único punto de entrada. Antes del clic no se puede decir la
// consecuencia concreta —todavía no está elegida—, así que se dice lo único
// cierto: que adentro hay una elección y que no da lo mismo cuál.
export const WHATSAPP_CONNECT_LABEL = "Conectar WhatsApp"

export const WHATSAPP_CONNECT_DESCRIPTION =
  "Meta abre su ventana y ahí eliges: dar de alta un número nuevo, o conectar el que ya usas en la app de WhatsApp Business. No da lo mismo cuál —cada opción deja el número de una manera distinta— y te contamos qué implica la que elijas en cuanto la ventana se cierre."

// La consecuencia concreta, **después** del cierre y según lo que el usuario
// eligió de verdad. Vive acá y no en el `.tsx` para que sea texto con test: es
// lo que le explica a alguien por qué su número dejó de abrir en el teléfono, o
// por qué tiene 24 horas para pedir el historial.
export const WHATSAPP_MODE_CAVEAT: Record<WhatsappOnboardingMode, string> = {
  standard:
    "Diste de alta un número nuevo en la API de WhatsApp: queda registrado para la API y deja de poder usarse desde la app de WhatsApp Business.",
  coexistence:
    "Conectaste el número que ya usas en la app de WhatsApp Business: sigue funcionando ahí y además llega a Resender. Meta decide la elegibilidad y el número queda con un techo fijo de 20 mensajes por segundo. El historial hay que sincronizarlo dentro de las 24 horas siguientes.",
}

// El modo que el launcher reenvía al servidor en el cierre. **Todo lo que no
// sea exactamente `coexistence` es el flujo estándar**, y no un error: un cuerpo
// tocado a mano tiene que caer en el flujo que no depende de que Meta habilite
// nada, no en el que sí.
//
// El valor legítimo ya no lo elige un botón: sale del evento de cierre del
// popup (`resolveWhatsappOnboardingMode`, en `signup-events.ts`), que es la
// única fuente que sabe qué eligió el usuario dentro del diálogo de Meta. Esto
// es solo el saneador del borde HTTP.
export function parseWhatsappMode(value: unknown): WhatsappOnboardingMode {
  return value === "coexistence" ? "coexistence" : "standard"
}
