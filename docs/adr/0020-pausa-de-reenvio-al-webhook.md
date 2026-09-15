---
status: accepted
---

# Pausa de reenvío al webhook, por conexión y por conversación

Fecha: 2026-09-14. Entrega: PR único sobre `dev`.

## Contexto

Un tenant que automatiza sobre el webhook necesita a veces que el bot **deje de recibir** sin
apagar nada: un humano toma una conversación, se prueba una automatización nueva, o el destino está
en mantenimiento. Hasta ahora las únicas formas de callar el reenvío eran borrar la `webhookUrl`
(y perder la firma configurada al volver a ponerla) o desconectar la cuenta (y dejar de recibir y
de enviar). Las dos son destructivas para lo que se quiere, que es un interruptor.

Lo que ya existía apunta a la forma correcta. La [Cuenta restringida](0003-plan-entitlements-usage-quota.md)
persiste el entrante, lo cuenta y lo registra como `skipped` en la bitácora de entregas con un
motivo; «sin `webhookUrl`» hace lo mismo. El reenvío se decide en un solo punto de la ingesta
(`lib/inbound/inbound-ingestion.ts`), una vez para DMs y otra para comentarios.

## Considered Options

- **Un valor `'paused'` en `connected_pages.status`.** Descartado: `status = 'active'` está
  cableado en todas las lecturas de envío e ingesta; una conexión «pausada» quedaría muda y sin
  poder enviar, que es justo lo contrario de lo que se pide. `status` y `token_status` son ejes
  independientes (ADR 0005); la pausa es un tercero.
- **Encolar lo que llega durante la pausa y reproducirlo al reanudar.** Descartado: orden,
  volumen, duplicados con los reintentos, y una avalancha al reanudar. Quien quiera el histórico
  lo tiene en Inbox y en la base. La pausa **descarta del reenvío**, igual que la restricción.
- **Comprobar también en el momento de entregar (`deliverJob`)**, para frenar lo que ya estaba
  en reintentos al pausar. Descartado por ahora: es una consulta más por intento y la ventana de
  reintentos son ~22 minutos. Si hace falta, es un cambio aparte.
- **Exponerlo en la API pública** (`PATCH` de conexión/conversación). Descartado en esta
  entrega: no existen endpoints de gestión de conexiones ni de conversaciones, y abrirlos es una
  superficie nueva que pide su propio diseño. Queda como deuda escrita; el caso de uso «el humano
  toma la conversación y el bot deja de recibir» se hace hoy desde la consola.
- **Un booleano `paused` más un `paused_at`.** Descartado: dos columnas que pueden contradecirse
  para decir una sola cosa.
- **Pausar la conversación sin tocar comentarios.** Descartado por el producto: pausar una
  conversación se entiende como pausar a esa persona, y en Instagram sus comentarios llegan por
  el mismo webhook.

## Decisión

Dos columnas `paused_at timestamptz null` (migración 0025), en `connected_pages` y en
`conversations`. Null es activa; una fecha es «pausada desde».

Reglas, en `lib/inbound/forwarding-pause.ts` (puro, con tests):

- **La conexión es la llave maestra.** Pausada, no se reenvía nada suyo —DMs ni comentarios— sin
  importar cada conversación. Reanudarla **no** reanuda las conversaciones pausadas una a una.
  Reenviar = conexión activa y conversación activa.
- **La conversación es «pausar a este contacto».** Corta sus DMs y, en Instagram, sus comentarios:
  la ingesta de comentarios busca la conversación de `from_ig_id` en la conexión, que es la misma
  identidad que `contact_id` (migración 0013). Sin conversación, el comentario sale.
- **Persistir, contar, no reenviar.** El entrante se guarda, se ve en Inbox y consume cuota como
  siempre. La entrega se registra `skipped` con `connection_paused` o `conversation_paused`; la
  restricción del tenant, si coincide, gana en el motivo porque explica más.
- **Solo en la ingesta.** Nada se encola para después ni se frena en la cola.
- **El envío por la API no se toca.** Pausar es dejar de notificar; responder sigue siendo
  posible.

Consola: un `Switch` —encendido es «reenviando»— con el estado en claro al lado, «Activo» /
«Pausado desde hace 2 h», en la tarjeta de conexión (pegado al bloque del webhook, con píldora
`reenvío pausado` junto al estado) y en la cabecera del hilo de Mensajes, que era el hueco que la
ADR 0018 dejó declarado. La fila de la lista lleva un icono de pausa. Sin confirmación: es
reversible al instante. Sin marca por mensaje de «no reenviado».

Acciones: `setConnectionForwardingPaused` en `features/connections/actions.ts` y
`setConversationForwardingPaused` en `features/inbox/actions.ts` (la primera acción del slice).
Log con `action: forwarding_pause | forwarding_resume`.

## Consequences

- Un tenant puede callar el webhook de una conexión o de un contacto y volver a encenderlo sin
  perder la URL, la firma ni el historial.
- Lo que llega durante la pausa **no se reenvía nunca**. Hay que decirlo en la UI (se dice bajo
  el interruptor cuando está pausado) y en la documentación pública.
- Un evento que ya estaba en reintentos cuando se pausó llega igual, hasta ~22 minutos después.
- Deuda: exponer la pausa en la API pública, junto con los endpoints de gestión que la ADR 0019
  ya deja anotados.
