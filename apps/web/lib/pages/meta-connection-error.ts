// Motivos de fallo del callback de Meta, traducidos (ADR 0005). Vivía como
// función local de `/connections`; acá es un módulo puro y testeable que
// también usa la server action de conexión, para que el mismo fallo no tenga
// dos redacciones distintas según por dónde llegó el usuario.
//
// Los cinco motivos, no tres: v2 solo ilustra `webhook_subscription_failed`,
// `page_owned:` y `state_mismatch`, pero el callback también devuelve
// `configuration_failed` y `meta_session_expired`.

const PAGE_OWNED_PREFIX = "page_owned:"

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

  // Motivo desconocido: se muestra crudo antes que tragárselo, porque es lo
  // único que el usuario puede citarnos en un correo de soporte.
  return `${PREFIX}: ${reason}.`
}

// Azúcar para el llamador que ya tiene el id a mano (la server action, cuando
// `connectAuthorizedPages` lanza `PageOwnershipError`).
export function metaPageOwnedReason(metaPageId: string): string {
  return `${PAGE_OWNED_PREFIX}${metaPageId}`
}
