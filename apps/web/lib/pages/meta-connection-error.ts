// Motivos de fallo del callback de Meta, traducidos (ADR 0005). Vivía como
// función local de `/connections`; acá es un módulo puro y testeable que
// también usa la server action de conexión, para que el mismo fallo no tenga
// dos redacciones distintas según por dónde llegó el usuario.
//
// Los cinco motivos, no tres: v2 solo ilustra `webhook_subscription_failed`,
// `page_owned:` y `state_mismatch`, pero el callback también devuelve
// `configuration_failed` y `meta_session_expired`.

const PAGE_OWNED_PREFIX = "page_owned:"
const INSTAGRAM_ACCOUNT_OWNED_PREFIX = "instagram_account_owned:"
const WHATSAPP_NUMBER_OWNED_PREFIX = "whatsapp_number_owned:"

// Todos los mensajes empiezan con este prefijo (spec C.8).
const PREFIX = "No se pudo conectar"

export function formatMetaConnectionError(reason?: string | null): string {
  if (!reason) return `${PREFIX}.`

  if (reason === "webhook_subscription_failed") {
    return `${PREFIX}: Meta no confirmó la suscripción al webhook de todas las páginas. Ninguna página quedó guardada.`
  }

  // Prefijo con el id de la página que ya pertenece a otro tenant: el ownership
  // se evalúa por página (ADR 0004), así que el mensaje la nombra.
  if (reason.startsWith(PAGE_OWNED_PREFIX)) {
    const pageId = reason.slice(PAGE_OWNED_PREFIX.length)
    return `${PREFIX}: la página ${pageId} ya pertenece a otra cuenta de Resender.`
  }

  if (reason === "configuration_failed") {
    return `${PREFIX}: el cifrado de secretos del servidor no está configurado.`
  }

  if (reason === "meta_session_expired") {
    return `${PREFIX}: tu autorización de Meta venció. Vuelve a conectar Facebook.`
  }

  if (reason === "state_mismatch") {
    return `${PREFIX}: la sesión de autorización venció o no coincide. Inténtalo de nuevo.`
  }

  // Motivos propios de Instagram. Nombran **en qué paso** falló porque los tres
  // se ven igual desde la pantalla —vuelves a Conexiones sin la cuenta— y son
  // problemas distintos: el intercambio falla por credenciales o redirect_uri
  // mal cargados, el perfil por permisos que el usuario no concedió, y la
  // suscripción por el webhook sin configurar en la app de Meta.
  if (reason === "instagram_exchange_failed") {
    return `${PREFIX}: Instagram no completó el intercambio de credenciales. Vuelve a intentarlo.`
  }

  if (reason === "instagram_profile_failed") {
    return `${PREFIX}: Instagram autorizó la cuenta pero no devolvió su perfil. Revisa que sea una cuenta profesional y vuelve a intentarlo.`
  }

  if (reason === "instagram_subscription_failed") {
    return `${PREFIX}: Instagram no confirmó la suscripción al webhook. La cuenta no quedó conectada.`
  }

  if (reason.startsWith(INSTAGRAM_ACCOUNT_OWNED_PREFIX)) {
    const accountId = reason.slice(INSTAGRAM_ACCOUNT_OWNED_PREFIX.length)
    return `${PREFIX}: la cuenta de Instagram ${accountId} ya pertenece a otra cuenta de Resender.`
  }

  // Motivos propios de WhatsApp, **uno por paso** del Embedded Signup, con el
  // mismo criterio que los de Instagram: desde la pantalla los cinco se ven
  // igual —vuelves a Conexiones sin el número— y son problemas distintos, con
  // dueños distintos. Nombrar el paso es lo que separa «revisá la configuración
  // de la app» de «el usuario no te asignó el número».
  //
  // Los pasos son los que nombra el PRD (`exchange`, `assets`, `register`,
  // `subscribe`, `persist`) y el orden de los `if` es el orden en el que
  // corren, que es también el orden en el que hay que leerlos al depurar.
  //
  // **La convención es `whatsapp_<step>_failed`**, uno por miembro del paso, y
  // está pensada para que el callback del Embedded Signup no tenga que conocer
  // este archivo: con el `step` que ya lleva su error a cuestas alcanza para
  // armar el `reason` del redirect.
  //
  // Falta `sync` a propósito: la sincronización de historial de Coexistence
  // arranca **después** de que la conexión ya quedó persistida, así que su
  // fallo no es «no se pudo conectar» —el número quedó conectado— y merece su
  // propio aviso de progreso en vez de un mensaje que contradiga la pantalla.
  if (reason === "whatsapp_exchange_failed") {
    return `${PREFIX}: Meta no completó el intercambio de credenciales de WhatsApp. Vuelve a intentarlo.`
  }

  if (reason === "whatsapp_assets_failed") {
    return `${PREFIX}: la autorización no incluyó el número ni la cuenta de WhatsApp Business. Vuelve a lanzarla y elige el número que quieres conectar.`
  }

  if (reason === "whatsapp_register_failed") {
    return `${PREFIX}: Meta no pudo registrar el número en Cloud API. Revisa que no esté en uso en otra plataforma y vuelve a intentarlo.`
  }

  if (reason === "whatsapp_subscribe_failed") {
    return `${PREFIX}: Meta no confirmó la suscripción al webhook de la cuenta de WhatsApp Business. El número no quedó conectado.`
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
  // así que **la causa número uno de este fallo no es un ataque ni un vencimiento
  // sino dos pestañas abiertas** — y el remedio es cerrar una y reintentar desde
  // la otra, que son diez segundos si alguien te lo dice y un correo a soporte
  // si no.
  if (reason === "whatsapp_state_mismatch") {
    return `${PREFIX}: la autorización no coincide con esta pestaña. Suele pasar cuando Conexiones quedó abierta en otra pestaña o ventana, porque la segunda invalida la conexión que empezó la primera. Cierra las demás y vuelve a lanzarla desde una sola.`
  }

  if (reason === "whatsapp_persist_failed") {
    return `${PREFIX}: el número se autorizó en Meta pero no se pudo guardar. Vuelve a intentarlo; si se repite, escríbenos.`
  }

  if (reason.startsWith(WHATSAPP_NUMBER_OWNED_PREFIX)) {
    const phoneNumberId = reason.slice(WHATSAPP_NUMBER_OWNED_PREFIX.length)
    return `${PREFIX}: el número de WhatsApp ${phoneNumberId} ya pertenece a otra cuenta de Resender.`
  }

  // Motivo desconocido: se muestra crudo antes que tragárselo, porque es lo
  // único que el usuario puede citarnos en un correo de soporte.
  return `${PREFIX}: ${reason}.`
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

// El tercero, para el callback de WhatsApp que se está escribiendo en paralelo:
// recibe el mismo `PageOwnershipError` con un `phone_number_id` adentro. El
// prefijo es propio y no se reusa `page_owned:` porque el mensaje nombra el
// canal, y decirle «la página 109…» a quien acaba de autorizar un número lo
// manda a buscar en el lugar equivocado.
export function whatsappNumberOwnedReason(phoneNumberId: string): string {
  return `${WHATSAPP_NUMBER_OWNED_PREFIX}${phoneNumberId}`
}
