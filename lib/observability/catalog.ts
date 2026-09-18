// Catálogo cerrado del log estructurado: los verbos (`LogAction`), los
// resultados (`LogOutcome`) y los motivos (`LogReason`). Vive aparte de la
// maquinaria de `logger.ts` para que se pueda leer entero, de una sola vez y
// sin nada más alrededor. Para agregar un literal: busca el marcador
// `@section <feature>` del módulo que lo emite y agrégalo en ese bloque; si el
// módulo es nuevo, abre una sección nueva antes de `@section end`.
//
// Solo tipos. La función `log()` y los campos siguen en `./logger`, que
// re-exporta todo esto para que ningún import cambie.

// Dónde corre la línea. Es el equivalente del `entrypoint` de `apps/api`, con
// los puntos de entrada que tiene Next: un route handler, una server action, o
// una tarea diferida con `after()` —que corre **después** de haber respondido y
// es, justamente, donde vive el reenvío al webhook del tenant—.
// `queue` y `scheduled` son los dos puntos de entrada que agrega `worker.ts`:
// el consumidor de `webhook-deliveries` (y de su DLQ) y el cron de recuperación.
// No son rutas de Next —no hay request ni sesión detrás—, así que se nombran
// aparte: filtrar por `entrypoint=queue` es «todo lo que pasó entregando», sin
// mezclar con lo que pasó recibiendo.
export type LogEntrypoint = "route" | "action" | "after" | "queue" | "scheduled"

// Verbos, unión cerrada, uno por punto de entrada real. Que sea cerrada es lo
// que hace que «mostrame todo lo que pasó con la cuenta X» sea un filtro por
// `accountId` y no una lista de nombres que hay que conocer de memoria.
export type LogAction =
  // @section inbound
  | "webhook_verify" // GET del challenge de Meta
  | "webhook_receive" // POST: firma, parseo y recuento del sobre
  | "inbound_ingest" // un evento del sobre: mensaje o comentario
  | "webhook_delivery" // reenvío al webhook del tenant
  | "queue_consume" // un mensaje de `webhook-deliveries` o de su DLQ
  | "delivery_recover" // cron: reclama jobs cuyo plazo durable ya venció
  // @section outbound
  | "outbound_send" // DM (Messenger o Instagram)
  | "comment_reply" // respuesta pública debajo del comentario
  | "comment_private_reply" // DM al autor del comentario
  // @section connections
  | "oauth_start"
  | "oauth_callback"
  | "account_connect"
  | "account_disconnect"
  | "webhook_subscribe"
  | "webhook_unsubscribe"
  | "webhook_url_save"
  | "webhook_secret_rotate" // el tenant pidió un secreto de firma nuevo
  // @section forwarding
  // Pausa de reenvío (ADR 0020). Dos verbos y no uno con `reason`: un `ok` no
  // lleva motivo, y «pausó» y «reanudó» son las dos líneas que se buscan.
  | "forwarding_pause"
  | "forwarding_resume"
  // @section account
  | "password_change" // la persona cambió su contraseña desde Ajustes
  | "session_revoke" // cierre de las demás sesiones tras cambiar la contraseña
  | "password_reset" // la persona recuperó su contraseña por correo
  // @section clients
  // Módulo Clientes (issue #154): lo que el padre hace desde `/clientes`.
  | "client_create" // creó el cliente y emitió la primera invitación
  | "client_invite" // reenvió la invitación (token nuevo, el anterior cancelado)
  | "client_invite_cancel"
  | "client_max_update"
  | "client_delete" // desconectó sus conexiones y borró al cliente entero
  | "client_invite_accept" // el cliente aceptó: user nuevo, verificado y con sesión
  // @section email
  // Un envío del [Canal de correo] (`lib/email/send-email.ts`). Es su propio
  // verbo y no un `outcome` del anterior porque el envío puede fallar solo:
  // el token se emitió igual y la persona se queda esperando un correo que no
  // llegó. Filtrar por `action=email_send` es «¿está vivo Resend?».
  | "email_send"
  // @section api-keys
  // Verificación del `Bearer` de la API externa. **Solo se escribe cuando la
  // verificación no pudo completarse**, no en cada request: una key inválida es
  // un 401 normal y ya lo cuenta el log de la ruta. Ver `lib/auth/api-keys.ts`.
  | "api_key_verify"
  // @section edge-effects
  // efectos de borde que hoy solo dejan un `console.error` suelto
  | "label_resolve" // @handle del contacto y permalink de la publicación
  | "token_exchange"
  | "token_invalidate"
  | "token_decrypt"
  | "media_download" // baja un medio entrante de WhatsApp de Meta a R2, y lo sirve
  | "usage_increment"
  | "subscription_check"
  // @section logs
  // La bitácora de la sección Logs (`request_logs`, migración 0028). Se escribe
  // best-effort: `request_log_write` **solo aparece cuando la escritura falló**,
  // que es la única señal de que al tenant le falta una fila en pantalla.
  | "request_log_write"
  | "request_log_purge" // cron: borra las filas que cumplieron la retención
// @section end

export type LogOutcome =
  | "ok"
  | "dropped" // descartado a propósito: no se persiste ni se reenvía
  | "duplicate" // ya estaba: reintento de Meta o carrera entre dos requests
  | "skipped" // se persistió, pero no se reenvía
  | "retry"
  | "failed"
  // Terminal y sin vuelta: la cola agotó sus reintentos y el job pasó por la
  // DLQ. Se separa de `failed` porque `failed` todavía puede tener intentos por
  // delante y `dead` no: es la línea que busca el runbook de la DLQ.
  | "dead"

// Catálogo cerrado de motivos. Es la lista completa de razones por las que algo
// puede no pasar, en un solo archivo y de una sola lectura: se puede leer entera
// antes de abrir la base. Agregar un descarte obliga a agregar acá su motivo, y
// esa fricción es deliberada.
export type LogReason =
  // @section inbound
  // verificación y recepción
  | "verify_token_mismatch"
  | "missing_signature"
  | "signature_mismatch"
  | "invalid_json"
  | "no_events_in_payload"
  // ingesta
  | "account_not_connected"
  | "no_active_subscription"
  | "already_ingested"
  | "self_authored_comment" // anti-bucle #2: el @handle es el de la propia cuenta
  | "own_published_comment" // anti-bucle #3: el comentario lo publicamos nosotros
  // @section delivery
  // entrega al webhook del tenant
  | "webhook_url_not_configured"
  | "webhook_url_invalid"
  | "account_restricted" // ADR 0003
  | "connection_paused" // ADR 0020: la conexión tiene el reenvío pausado
  | "conversation_paused" // ADR 0020: la conversación (el contacto) lo tiene
  | "http_error"
  | "network_error"
  | "max_attempts_exhausted"
  // cola y recuperación
  | "job_already_terminal" // el job ya estaba cerrado: no se entrega dos veces
  | "invalid_queue_payload" // el cuerpo del mensaje no trae un `jobId`
  | "queue_retries_exhausted" // llegó a la DLQ: el job queda `dead`
  | "dlq_persist_failed"
  // @section outbound
  // salida hacia Meta
  | "meta_rejected"
  | "page_not_connected"
  | "conversation_not_found" // ADR 0019: `conversationId` que el tenant no tiene
  | "comment_not_found"
  | "reply_too_long"
  // @section api-gates
  // gates de las rutas salientes
  | "unauthorized"
  | "rate_limited" // la API key superó su cuota por minuto (429)
  | "waitlisted"
  | "channel_not_enabled" // ADR 0010: el tenant no tiene permiso para ese canal
  // WhatsApp: el contacto no escribió en las últimas 24 h, así que Meta sólo
  // aceptaría una plantilla. Se corta acá y no se llama a Cloud API.
  | "customer_service_window_closed"
  | "plan_restricted"
  | "invalid_request"
  | "idempotent_replay"
  // @section connections
  // OAuth y conexión
  | "not_authenticated"
  | "user_cancelled"
  | "missing_code"
  | "state_mismatch"
  | "token_exchange_failed"
  | "profile_fetch_failed"
  | "subscription_failed"
  | "unsubscribe_failed"
  // WhatsApp: en este canal se conecta un número y se suscribe el WABA, así que
  // la baja necesita saber de qué WABA cuelga y si queda algún número vivo.
  | "missing_waba_id"
  | "waba_has_active_numbers"
  // @section media
  // La fila dice `available` y R2 no tiene el objeto: el estado derivado y el
  // bucket se separaron, que es justo lo que la lifecycle rule debería evitar.
  | "media_object_missing"
  // No se pudo bajar el medio de Meta y no vale la pena reintentar: MIME fuera
  // de catálogo, archivo demasiado grande, o el media id ya no resuelve.
  | "media_download_failed"
  // @section whatsapp
  // Se agotaron los reintentos del pedido de sync de Coexistence. Importa que
  // sea visible: sin el sync, la conexión muere sola a las 24 h.
  | "history_sync_failed"
  | "account_owned_by_other_tenant"
  | "page_limit_reached"
  // @section clients
  // Módulo Clientes: por qué el padre no pudo crear o administrar un cliente.
  | "plan_not_allowed" // Starter o Free: el módulo no está operable
  | "email_taken" // el correo ya tiene cuenta o invitación viva
  | "max_out_of_range" // tope fuera de `1..maxPages` del plan
  | "invitation_not_found"
  // Por qué un enlace `/invitacion/<token>` no se pudo aceptar (ticket #156).
  | "invitation_expired"
  | "invitation_cancelled"
  | "invitation_consumed" // ya se usó, o dos aceptaciones simultáneas
  | "configuration_failed"
  // @section edge-effects
  | "usage_counter_failed"
  | "internal_error"
  // @section email
  // El [Canal de correo] no tiene `RESEND_API_KEY`. No es un fallo del
  // proveedor: es `next dev` o vitest, donde el secreto no existe a propósito.
  | "not_configured"
// @section end
