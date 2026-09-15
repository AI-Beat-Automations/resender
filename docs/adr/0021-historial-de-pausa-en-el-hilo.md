---
status: accepted
---

# Historial de pausa dentro del hilo de Inbox

Fecha: 2026-09-15. Entrega: PR único sobre `dev`, apilado sobre el cambio de vocabulario
(«Automatización» en vez de «Reenvío al webhook»).

## Contexto

La [ADR 0020](0020-pausa-de-reenvio-al-webhook.md) puso el interruptor de pausa en la cabecera del
hilo con el estado al lado: «Pausada desde hace 2 h». Funciona, pero cuenta poco y en el sitio
equivocado. Quien abre una conversación pausada quiere saber **qué mensajes llegaron con el bot
apagado**, y eso se lee mirando el hilo, no una esquina. Además el «hace 2 h» envejece con la página
abierta, y en cuanto se reactiva desaparece: no queda rastro de que hubo una pausa.

El dato tampoco existía. `conversations.paused_at` es una sola fecha que se borra al reanudar; no
hay de dónde sacar «se pausó el martes a las 10:32 y se reactivó a las 11:05», ni una segunda pausa
después.

## Considered Options

- **Dejar solo el estado actual, pero como fila al final del hilo.** Descartado: sigue sin decir
  cuándo se reactivó, y al reactivar se esfuma. Es el mismo dato en otro lugar.
- **Derivar el historial de la bitácora de entregas.** Los `skipped` con `conversation_paused`
  marcan qué llegó durante la pausa, pero no cuándo se pausó ni cuándo se reanudó: una pausa sin
  mensajes en medio sería invisible. Descartado.
- **Derivar del log de observabilidad** (`forwarding_pause` / `forwarding_resume`). No es una
  fuente de datos de producto: se rota, no se consulta por tenant y no está en la base.
- **Reemplazar `paused_at` por «el último evento».** Descartado: la ingesta lee `paused_at` en
  cada entrante y una columna es más barata que un subquery; y las dos cosas responden preguntas
  distintas (estado de ahora vs. historia).
- **Eventos también para la conexión.** No hay hilo donde dibujarlos. Cuando haga falta, es la
  misma forma con otra clave.

## Decisión

Tabla `conversation_pause_events` (migración 0026): `tenant_id`, `conversation_id`, `paused`
booleano y `created_at`. Una fila por cambio real de estado; `paused_at` se queda como está para
la ingesta. La migración hace backfill: cada conversación ya pausada nace con su evento «pausada»
fechado en `paused_at`, para que el hilo no contradiga al interruptor.

`setConversationForwardingPaused` escribe el `update` y el `insert` en un solo statement (CTE), y
el `update` exige que el estado cambie (`(paused_at is null) = paused`). Así la acción sigue
siendo idempotente y **no deja eventos repetidos** si alguien pulsa dos veces. Sin cambio, se
relee la conversación para devolver el mismo resultado de antes.

Lectura: `listConversationPauseEvents` en el read model, y `toThreadTimeline` en la capa de
presentación mezcla mensajes y eventos por instante (a igual instante, el mensaje primero: quien
pausa lo hace después de leer lo que acaba de llegar). El separador de día se calcula sobre la
secuencia mezclada. `toThreadMessageViews` sigue existiendo para quien solo quiera burbujas.

Consola: el interruptor de la cabecera queda en «Automatización» y el switch, sin texto de
estado: encendido o apagado ya lo dice. El hilo dibuja cada evento
como una píldora centrada entre las burbujas —aviso al pausar, éxito al reactivar— con fecha
absoluta: «Automatización pausada desde el 14 sept 2026, 10:32» / «Automatización activada desde
el 14 sept 2026, 11:05». Los eventos se quedan para siempre. La tarjeta de Conexiones no cambia.

## Consequences

- El hilo cuenta la pausa como parte de la conversación: se ve entre qué mensajes el bot no
  recibió, y cuántas veces pasó.
- Una tabla más que crece un poco por cada clic en el interruptor. Es despreciable frente a
  `messages`, y cae en cascada con la conversación.
- Las conversaciones pausadas antes de la 0026 ven su evento en la fecha real de la pausa; las
  reactivadas antes de la 0026 no tienen historial, porque no existía.
- Queda sin hacer, a propósito, la marca por mensaje «guardado en Inbox · automatización pausada»
  del mock. Hay dato para hacerla (la bitácora de entregas) y es un cambio aparte.
