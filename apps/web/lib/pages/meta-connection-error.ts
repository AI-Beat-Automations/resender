import { fmt, type AppDict } from "@/content/i18n/app"

// Motivos de fallo del callback de Meta (ADR 0005). Vivía como función local de
// `/connections`; acá es un módulo puro y testeable que también usa la server
// action de conexión, para que el mismo fallo no tenga dos redacciones distintas
// según por dónde llegó el usuario.
//
// El **texto** de cada motivo vive en `t.metaErrors`; lo que se queda acá es el
// mapeo `reason` → clave, que es lo que hay que mantener sincronizado con los
// callbacks y lo único que tiene tests. Los tres `*_owned` llevan prefijo porque
// arrastran un id: el ownership se evalúa por cuenta (ADR 0004), así que el
// mensaje la nombra.
//
// Los prefijos y los constructores de `reason` no se traducen: son el contrato
// del querystring entre el callback y la pantalla.

const PAGE_OWNED_PREFIX = "page_owned:"
const INSTAGRAM_ACCOUNT_OWNED_PREFIX = "instagram_account_owned:"
const WHATSAPP_NUMBER_OWNED_PREFIX = "whatsapp_number_owned:"

/**
 * El texto que ve el usuario para un `reason` del querystring.
 *
 * `t` no tiene valor por defecto a propósito: quien llama tiene el diccionario
 * a mano —la pantalla y las server actions ya lo resuelven— y un default en
 * español convertiría cada llamada olvidada en un mensaje sin traducir que
 * nadie nota.
 */
export function formatMetaConnectionError(
  reason: string | null | undefined,
  t: AppDict
): string {
  const e = t.metaErrors
  if (!reason) return e.empty

  if (reason === "webhook_subscription_failed") {
    return e.webhookSubscriptionFailed
  }

  // Prefijo con el id de la página que ya pertenece a otro tenant: el ownership
  // se evalúa por página (ADR 0004), así que el mensaje la nombra.
  if (reason.startsWith(PAGE_OWNED_PREFIX)) {
    return fmt(e.pageOwned, { id: reason.slice(PAGE_OWNED_PREFIX.length) })
  }

  if (reason === "configuration_failed") {
    return e.configurationFailed
  }

  if (reason === "meta_session_expired") {
    return e.metaSessionExpired
  }

  if (reason === "state_mismatch") {
    return e.stateMismatch
  }

  // Motivos propios de Instagram. Nombran **en qué paso** falló porque los tres
  // se ven igual desde la pantalla —vuelves a Conexiones sin la cuenta— y son
  // problemas distintos: el intercambio falla por credenciales o redirect_uri
  // mal cargados, el perfil por permisos que el usuario no concedió, y la
  // suscripción por el webhook sin configurar en la app de Meta.
  // El rebote del gate de canal (ADR 0010). No es un fallo de Meta ni del
  // usuario: la cuenta no tiene el permiso, y sin decirlo la pantalla mostraría
  // el motivo crudo justo cuando la explicación es lo único que sirve.
  if (reason === "instagram_not_enabled") {
    return e.instagramNotEnabled
  }

  // El rebote por cupo del callback de Instagram (ADR 0011). Habla de
  // **conexiones** y no de páginas porque el cupo cuenta las dos cosas: quien
  // lee esto puede tener el slot ocupado por una Página de Facebook.
  if (reason === "instagram_page_limit_reached") {
    return e.instagramPageLimitReached
  }

  if (reason === "instagram_exchange_failed") {
    return e.instagramExchangeFailed
  }

  if (reason === "instagram_profile_failed") {
    return e.instagramProfileFailed
  }

  if (reason === "instagram_subscription_failed") {
    return e.instagramSubscriptionFailed
  }

  if (reason.startsWith(INSTAGRAM_ACCOUNT_OWNED_PREFIX)) {
    return fmt(e.instagramAccountOwned, {
      id: reason.slice(INSTAGRAM_ACCOUNT_OWNED_PREFIX.length),
    })
  }

  // Motivos propios de WhatsApp, **uno por paso** del Embedded Signup, con el
  // mismo criterio que los de Instagram: desde la pantalla todos se ven igual
  // —vuelves a Conexiones sin el número— y son problemas distintos, con dueños
  // distintos. Nombrar el paso es lo que separa «revisa la configuración de la
  // app» de «el usuario no te asignó el número».
  //
  // Los pasos son los de `WhatsappOnboardingStep` (`lib/meta/whatsapp-client.ts`)
  // y el orden de los `if` es el orden en el que corren, que es también el
  // orden en el que hay que leerlos al depurar. **La convención es
  // `whatsapp_<step>_failed`**, uno por miembro del paso, y está pensada para
  // que el cierre del Embedded Signup no tenga que conocer este archivo: con el
  // `step` que ya lleva su error a cuestas alcanza para armar el `reason`.
  if (reason === "whatsapp_not_enabled") {
    return e.whatsappNotEnabled
  }

  if (reason === "whatsapp_page_limit_reached") {
    return e.whatsappPageLimitReached
  }

  if (reason === "whatsapp_exchange_failed") {
    return e.whatsappExchangeFailed
  }

  if (reason === "whatsapp_assets_failed") {
    return e.whatsappAssetsFailed
  }

  if (reason === "whatsapp_register_failed") {
    return e.whatsappRegisterFailed
  }

  if (reason === "whatsapp_subscribe_failed") {
    return e.whatsappSubscribeFailed
  }

  // `sync_request` es el único paso que puede fallar **con el número ya
  // conectado**: la conexión de Coexistence se persiste antes de pedir el
  // historial, justamente para no arrancar el reloj de 24 h sobre una fila que
  // todavía no existe. Por eso el texto no promete que no quedó nada guardado
  // —quedó— y manda a rehacer el alta, que es lo único que vuelve a abrir la
  // ventana del historial.
  if (reason === "whatsapp_sync_request_failed") {
    return e.whatsappSyncRequestFailed
  }

  // El `state_mismatch` de WhatsApp merece su propio texto porque su causa
  // probable es otra y es **accionable**, y porque el momento en que aparece es
  // el peor posible: el usuario ya creó el WABA, ya verificó el número por SMS y
  // ya autorizó, y lo que recibe es que «la sesión venció» con un `code` de 30
  // segundos ya gastado.
  //
  // Messenger e Instagram protegen su callback con una cookie de `state` que se
  // siembra en la misma navegación que abre el diálogo; acá el nonce vive en una
  // cookie única por navegador que el launcher emite al montarse. Abrir
  // Conexiones en una segunda pestaña reemite el nonce y pisa el de la primera,
  // así que **la causa número uno de este fallo no es un ataque ni un
  // vencimiento sino dos pestañas abiertas** — y el remedio es cerrar una y
  // reintentar desde la otra, que son diez segundos si alguien te lo dice y un
  // correo a soporte si no.
  if (reason === "whatsapp_state_mismatch") {
    return e.whatsappStateMismatch
  }

  if (reason === "whatsapp_persist_failed") {
    return e.whatsappPersistFailed
  }

  if (reason.startsWith(WHATSAPP_NUMBER_OWNED_PREFIX)) {
    return fmt(e.whatsappNumberOwned, {
      id: reason.slice(WHATSAPP_NUMBER_OWNED_PREFIX.length),
    })
  }

  // Motivo desconocido: se muestra crudo antes que tragárselo, porque es lo
  // único que el usuario puede citarnos en un correo de soporte.
  return fmt(e.unknown, { reason })
}

// Azúcar para el llamador que ya tiene el id a mano (la server action, cuando
// `connectAuthorizedPages` lanza `PageOwnershipError`).
export function metaPageOwnedReason(metaPageId: string): string {
  return `${PAGE_OWNED_PREFIX}${metaPageId}`
}

// El equivalente para el callback de Instagram, que recibe el mismo
// `PageOwnershipError` pero con un IG ID adentro.
export function instagramAccountOwnedReason(igUserId: string): string {
  return `${INSTAGRAM_ACCOUNT_OWNED_PREFIX}${igUserId}`
}

// El tercero, para el cierre del Embedded Signup de WhatsApp: recibe el mismo
// `PageOwnershipError` con un `phone_number_id` adentro. El prefijo es propio y
// no se reusa `page_owned:` porque el mensaje nombra el canal, y decirle «la
// página 109…» a quien acaba de autorizar un número lo manda a buscar en el
// lugar equivocado.
export function whatsappNumberOwnedReason(phoneNumberId: string): string {
  return `${WHATSAPP_NUMBER_OWNED_PREFIX}${phoneNumberId}`
}

// El `reason` del querystring a partir del paso que falló. Es una plantilla y
// no una tabla justamente para que agregar un paso a `WhatsappOnboardingStep`
// no obligue a mantener dos listas en sincronía: el `if` de arriba que falte se
// nota porque el mensaje sale crudo, no porque el mapeo se pierda.
export function whatsappStepFailedReason(step: string): string {
  return `whatsapp_${step}_failed`
}
