---
status: accepted
---

# `conversationId` basta para enviar

Fecha: 2026-09-09. Issue #129. Entrega: PR único sobre `dev`.

## Contexto

Para responder a un mensaje que llegó por el webhook, el cliente tenía que traducir
identificadores: el push trae `page.id` y `page.metaPageId`, pero el envío pide `pageId` y espera
el **segundo**; trae `conversation.contactId`, pero el envío lo llama `recipientId`; y
`conversationId` era opcional pero no bastaba, porque los otros dos seguían siendo obligatorios y
se validaban contra él. El resultado: quien integra manda el `page.id` interno y recibe `404`, o
pasa los tres campos sin saber cuál manda.

Resender ya tiene todo lo necesario en `conversations` (`connected_page_id`, `contact_id`) para
resolver la página, el canal y el destinatario a partir del id de conversación.

## Considered Options

- **`pageId` (nuestro uuid) + `contactId` como única forma.** Mismos nombres que el webhook y
  sirve para iniciar, pero obliga a dos campos siempre y a renombrar `pageId` con otro significado
  en la misma clave: los clientes actuales mandan un `metaPageId` en `pageId` y no habría forma de
  distinguir sin heurística de formato. Rechazada.
- **Endpoint nuevo `POST /api/messages` con los tres actuales deprecados.** Más limpio (el canal
  sale de la conversación, no de la URL), pero es un cambio de superficie que pide coordinación
  con clientes y una fecha de retiro. Rechazada; queda como deuda escrita, junto con el rename de
  `recipientId` → `contactId` y la respuesta anidada.
- **Aceptar en `pageId` tanto el uuid como el `metaPageId`.** Ambiguo, y no resuelve el problema
  de fondo (seguir pidiendo el contacto). Rechazada.

## Decisión

`conversationId` pasa a ser suficiente para enviar en los tres endpoints de DM
(`/api/meta/send`, `/api/meta/instagram/send`, `/api/meta/whatsapp/send`). Resender resuelve
internamente `metaPageId`, token y destinatario. `pageId` + `recipientId` siguen aceptados como
**modo de inicio** (escribirle a alguien de quien no hay conversación) y para no romper a los
clientes actuales.

Regla: `conversationId` **o** (`pageId` + `recipientId`). Si vienen los tres, deben coincidir
(comportamiento actual, se conserva). La URL sigue saliendo del canal (`page.channel` del push).

```
# Responder a un webhook
POST /api/meta/send
{ "conversationId": "6f0e5a2c-…", "reply": "…" }

# Iniciar, o clientes actuales
POST /api/meta/send
{ "pageId": "1234567890", "recipientId": "2468…", "reply": "…" }
```

Implementación: el parser de `lib/outbound/send-request.ts` devuelve un `target` discriminado
(`conversation` | `contact`), con los códigos nuevos `send_destination_missing` y
`send_destination_incomplete`. Un módulo nuevo, `lib/outbound/resolve-send-target.ts`, resuelve
las dos formas a `{ page, pageAccessToken, conversation }` y las tres rutas lo comparten; nada más
cambia en ellas (idempotencia, entitlement, ventana de 24 h, persistencia, logs, respuesta).

## Consequences

- Compatibilidad total: el par `pageId` + `recipientId` y los tres campos juntos siguen
  funcionando igual, con los mismos textos de error.
- Códigos nuevos: `conversationId` desconocido para el tenant es `404 { error: "conversation not
  found" }` (antes era un `400` inalcanzable en la práctica); conversación de otro canal que el de
  la ruta es `400 { code: "conversation_channel_mismatch", error: "conversation belongs to
  <channel>; use /api/meta/<ruta>" }`.
- La respuesta de éxito no cambia (`resender.conversationId`, `messageId`, `status`).
- Los snippets del quickstart pasan a `conversationId`. La `/docs` pública no vive en este repo:
  tarea aparte.
- Deuda escrita: comentarios siguen con `commentId` = id de Meta (issue hermano); rename de
  `recipientId`, `metaMessageId`/`igCommentId`/`replyToProviderMessageId` y forma anidada de la
  respuesta; endpoint unificado por conversación; `phoneNumberId` duplicado de `metaPageId` en el
  push de WhatsApp.
