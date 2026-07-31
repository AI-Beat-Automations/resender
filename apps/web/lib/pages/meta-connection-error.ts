// Motivos de fallo del callback de Meta, traducidos (ADR 0005). Vivía como
// función local de `/connections`; acá es un módulo puro y testeable que
// también usa la server action de conexión, para que el mismo fallo no tenga
// dos redacciones distintas según por dónde llegó el usuario.
//
// Los cinco motivos, no tres: v2 solo ilustra `webhook_subscription_failed`,
// `page_owned:` y `state_mismatch`, pero el callback también devuelve
// `configuration_failed` y `meta_session_expired`.

// Todos los mensajes empiezan con este prefijo (spec C.8).
const PREFIX = "No se pudo conectar"

export function formatMetaConnectionError(reason?: string | null): string {
  if (!reason) return `${PREFIX}.`

  if (reason === "webhook_subscription_failed") {
    return `${PREFIX}: Meta no confirmó la suscripción al webhook de todas las páginas. Ninguna página quedó guardada.`
  }

  if (reason.startsWith("page_owned:")) {
    return `${PREFIX}: una página seleccionada ya pertenece a otra cuenta de Resender.`
  }

  if (reason === "configuration_failed") {
    return `${PREFIX}: el cifrado de secretos del servidor no está configurado.`
  }

  if (reason === "meta_session_expired") {
    return `${PREFIX}: tu autorización de Meta venció. Vuelve a conectar Facebook.`
  }

  if (
    reason === "state_mismatch" ||
    reason === "state_missing" ||
    reason === "state_expired"
  ) {
    return `${PREFIX}: la sesión de autorización venció o no coincide. Inténtalo de nuevo.`
  }

  if (reason === "provider_cancelled") {
    return `${PREFIX}: cancelaste la autorización en Meta.`
  }
  if (reason === "missing_code" || reason === "meta_session_expired") {
    return `${PREFIX}: tu autorización de Meta venció. Vuelve a conectar Facebook.`
  }
  if (
    reason === "backend_unavailable" ||
    reason === "backend_invalid" ||
    reason === "exchange_failed"
  ) {
    return `${PREFIX}: el servicio no está disponible en este momento. Inténtalo de nuevo.`
  }

  return `${PREFIX}.`
}
