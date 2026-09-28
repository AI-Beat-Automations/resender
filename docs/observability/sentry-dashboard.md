# Dashboard de Sentry: cómo se lee

Guía del dashboard de salud de Resender en Sentry (`resenderdev`). Todos los widgets usan el dataset **Logs**, que es lo que emite `log()` de `lib/observability/logger.ts`.

## Antes de leer

- **Solo producción reporta.** Staging y local tienen Sentry apagado.
- **Cada línea es un `event` = `<action>_<outcome>`**, por ejemplo `webhook_delivery_ok`. Los campos (`action`, `outcome`, `reason`, `channel`, `tenantId`, `jobId`, `requestId`, `errorCode`, `durationMs`) son atributos filtrables. El catálogo cerrado de acciones y motivos está en `lib/observability/catalog.ts`.
- **Un atributo aparece en los selectores recién cuando llegó el primer log que lo trae.** Si no sale, escríbelo a mano.
- **`outcome`** puede ser: `ok`, `dropped` (descartado a propósito), `duplicate` (reintento de Meta), `skipped` (guardado pero no reenviado), `retry` (tiene intentos por delante), `failed` y `dead` (se agotaron los reintentos: DLQ).

## El recorrido de un mensaje

Un mensaje entrante sano deja cuatro líneas en Sentry:

```
webhook_receive_ok   → Meta nos mandó el webhook y lo aceptamos      (requestId)
inbound_ingest_ok    → se guardó el mensaje o comentario             (requestId)
webhook_enqueue_ok   → el job entró a la cola de entregas            (requestId, jobId)
webhook_delivery_ok  → la cola se lo entregó al agente del tenant    (jobId)
```

Para seguir un caso puntual: busca por `requestId` para ver las tres primeras y por `jobId` para ver las dos últimas. Si la cadena se corta, la última línea que aparece dice dónde se cortó y su `reason` dice por qué.

## Widgets

### 0. Jobs muertos (DLQ)

`Line` · Filter `outcome:dead` · rangos 🟢 0–0 · 🟡 0–5 · 🔴 5+

- **Qué es:** entregas que agotaron todos sus reintentos. Ese mensaje **no le llegó** al agente.
- **Sano:** siempre 0.
- **Si sube:** el webhook del tenant estuvo caído varios minutos. Revisa `reason` (`queue_retries_exhausted`, `dlq_persist_failed`) y el `jobId` en la sección Logs del producto.

### 1. Salud de entregas al agente

`Line` · Filter `action:webhook_delivery` · Group by `outcome` · sin rangos

- **Qué es:** qué pasó con cada entrega al webhook del tenant.
- **Sano:** casi todo es `ok`. Algún `retry` suelto es normal (el endpoint tardó o respondió 5xx una vez).
- **Si sube `retry`:** el endpoint de algún tenant está inestable. Si también sube `failed` o `dead`, está caído.
- **`skipped`:** el mensaje se guardó pero no se reenvía (sin URL configurada o reenvío pausado, ADR 0020). Es normal y no es un fallo.
- Encolar no cuenta aquí: es `webhook_enqueue`. Cada mensaje suma una sola entrega.

### 2. Clientes con más fallos

`Table` · Filter `outcome:failed` · columnas `tenantId` · `action` · `count(logs)`

- **Qué es:** qué tenant falla y en qué paso.
- **Cómo se lee:** la primera fila es el cliente más afectado. La columna `action` dice si es la entrega a su agente (`webhook_delivery`), un envío a Meta (`outbound_send`, `comment_reply`…) o la conexión (`oauth_callback`…).
- **Si un solo tenant domina la tabla:** casi siempre el problema es de su configuración (URL, token), no de Resender.
- **Si están todos repartidos:** probablemente el problema es nuestro o de Meta.

### 3. Envíos rechazados por Meta

`Line` · Filter `action:[outbound_send,comment_reply,comment_private_reply] outcome:failed` · Group by `action`, `channel` (y `errorCode` cuando exista) · rangos 🟢 0–5 · 🟡 5–20 · 🔴 20+

- **Qué es:** DMs, respuestas públicas y respuestas privadas que Meta no aceptó.
- **Sano:** unos pocos al día (un contacto que bloqueó la página, un comentario borrado).
- **Si hay un pico:** mira el `errorCode`. Los más comunes:
  - `190`: token vencido o revocado. El cliente tiene que reconectar.
  - `10` / `200`: falta un permiso de la app.
  - `4` / `17` / `32` / `613`: rate limit de Meta.
- **Si el pico está en un solo `channel`:** Meta cambió algo en ese canal.

### 4. Eventos que llegan de Meta

`Line` · Filter `action:webhook_receive` · Group by `outcome`, `channel` · sin rangos

- **Qué es:** cada webhook que Meta nos manda.
- **Sano:** `ok` sigue el ritmo del tráfico. Los `dropped` se leen por su `reason`:
  - `ignored_event_types` (nivel `info`): el sobre solo traía eventos que se descartan a propósito. Es normal. `ignoredKinds` dice cuáles: `echo` (mensaje de la propia cuenta), `no_message` (visto o reacción), `deleted` (el contacto borró el mensaje), `non_text` (foto, sticker o ❤️; Instagram solo acepta texto por ahora).
  - `no_events_in_payload` (nivel `warn`): llegó algo que el parser no supo explicar. **Esta es la alarma.** Mira `entryCount`, `messagingCount` y `changeCount`, y busca una línea `inbound_ingest_dropped` con el mismo `requestId`: si existe, el mensaje se reconoció pero se descartó después (cuenta no conectada, sin suscripción).
  - `signature_mismatch`: la firma no coincide, así que el secreto de la app está equivocado.
- **Si `ok` cae a cero en horario normal:** Meta dejó de mandarnos eventos. Revisa la app de Meta (modo desarrollo), la suscripción del webhook y el secreto de la app.
- **Si `no_events_in_payload` sube de golpe:** el parser dejó de reconocer el payload.
- **Si `non_text` sube de golpe sin que los contactos manden más fotos:** puede que Meta haya movido el texto de lugar. Revisa `lib/inbound/instagram-webhook.ts`.
- Para ver los descartes por tipo: Filter `action:webhook_receive outcome:dropped`, Group by `reason` y `ignoredKinds`.
- **`failed`:** error nuestro al procesar. Siempre debería estar en 0.

### 5. Latencia de entrega al agente

`Line` · Visualize `p95(durationMs)` · Filter `action:webhook_delivery` · rangos 🟢 0–2000 · 🟡 2000–5000 · 🔴 5000+

- **Qué es:** cuánto tarda en responder el endpoint del tenant (en ms). El 95 % de las entregas tarda menos que este valor.
- **Sano:** menos de 2 s.
- **Si sube:** los agentes de los clientes están respondiendo lento. Agrega Group by `tenantId` para ver cuál. Por encima de 5 s aparecen timeouts y `retry`.
- Mide solo el endpoint del cliente, no la espera en la cola (unos segundos entre `webhook_enqueue_ok` y `webhook_delivery_ok`).

### 6. Conexiones con Meta que fallan

`Table` · Filter `action:[token_exchange,oauth_callback,account_connect] outcome:failed` · columnas `tenantId` · `channel` · `count(logs)`

- **Qué es:** clientes que intentan conectar su página, cuenta o número y no pueden.
- **Cómo se lee:** mira el `reason` del log:
  - `token_exchange_failed`: Meta no devolvió el token.
  - `profile_fetch_failed`: hubo token, pero Meta no devolvió la página o la cuenta.
  - `state_mismatch`: el flujo OAuth se abrió en otra pestaña o expiró.
  - `missing_code`: Meta volvió sin código, casi siempre porque faltan permisos en el diálogo.
  - `account_owned_by_other_tenant`: esa página o número ya está conectado en otra cuenta de Resender.
- Si la persona cierra el diálogo de Meta queda `user_cancelled`, que es `dropped` y no aparece aquí: es normal.
- **Si varios tenants fallan a la vez:** revisa la configuración de la app de Meta.
- Los tokens que se vencen **después** de conectar no aparecen aquí: salen en el widget 3 con `errorCode` `190`.

### 7. Volumen por cliente (recibidos y enviados)

`Table` · Filter `action:[inbound_ingest,outbound_send,comment_reply,comment_private_reply] outcome:ok` · columnas `tenantId` · `action` · `count(logs)` · High to low · límite 20

- **Qué es:** cuántos mensajes recibe y envía cada cliente.
- **Cómo se lee:** cada fila es un cliente con un tipo de mensaje. La primera es el de más volumen.
  - `inbound_ingest`: **recibidos**, los DMs y comentarios que entraron.
  - `outbound_send`: **enviados**, los DMs que mandó su agente.
  - `comment_reply` / `comment_private_reply`: respuestas a comentarios.
- **Para qué sirve:** ver quién usa más Resender y detectar cambios bruscos. Un cliente que recibe mucho y no envía nada suele tener el agente caído o el reenvío pausado.
- **Dos rankings separados:** duplica la tabla con columnas `tenantId` · `count(logs)`. Una lleva el filtro `action:inbound_ingest outcome:ok` (más recibidos) y la otra `action:[outbound_send,comment_reply,comment_private_reply] outcome:ok` (más enviados).
- **Cuidado con el historial de WhatsApp:** al conectar un número se importan hasta 180 días de conversaciones, y cada mensaje importado también cuenta como `inbound_ingest_ok`. Ese día el cliente aparece con miles de recibidos que no son tráfico real, y hoy el log no permite separarlos.

## Editar un widget

En el dashboard, pasa el mouse sobre el widget → **⋯** → **Edit Widget** → **Update Widget**. Si entraste en modo edición del dashboard, termina con **Save and Finish**.

Para agregar un widget nuevo que lea un log nuevo, primero agrega la acción o el motivo en `lib/observability/catalog.ts` (ver `docs/CODE-PATTERNS.md`).
