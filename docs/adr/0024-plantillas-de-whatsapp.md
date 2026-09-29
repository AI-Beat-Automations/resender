---
status: accepted
---

# Plantillas de WhatsApp: Meta es dueño, Resender guarda una copia que no decide

Fecha: 2026-09-28. Decisión del issue #79, escrita en el ticket 1 de 10 (#198).
Se numera 0024 porque la 0014 ya la usa Better Auth.

**Supersede:**

- de la [ADR 0013](0013-whatsapp-como-tercer-canal.md), la sección «La ventana de 24 h se aplica
  localmente y no hay plantillas» y el punto 2 de «Cuándo revisar esta decisión»;
- de `prd_whatsapp.md`, la sección «Regla explícita sobre plantillas».

Lo que sigue valiendo de esas secciones: la ventana de 24 h se resuelve **en local**, contra
`conversations.last_inbound_at`, antes de llamar a Meta. Lo que cambia es que ahora hay una forma
de escribir con la ventana cerrada.

## Contexto

WhatsApp está en producción desde la ADR 0013 y **no puede iniciar conversaciones**. Fuera de la
[Ventana de atención] de 24 h, `POST /api/meta/whatsapp/send` corta con
`409 customer_service_window_closed`, `requiresTemplate: true` y
`templateSendingSupported: false`. El negocio solo puede responder: no puede mandar un
recordatorio de cita, un aviso de envío ni retomar una conversación que se enfrió.

La ADR 0013 advirtió que las plantillas rompen tres supuestos: que el usuario final escribe
primero, que la ventana es la única regla de envío y que no administramos assets de mensajería
en Meta. Los tres se rompen acá, a propósito.

Hechos de Meta que gobiernan el diseño:

- La identidad de una plantilla es **`(nombre, idioma)`**. La misma plantilla en cinco idiomas
  son cinco plantillas.
- Al enviar solo se acepta `name` + `language`. Meta no expone un id en el envío.
- La plantilla vive **en la WABA**, no en el número, y una WABA puede tener números de tenants
  distintos.
- Editarla la devuelve a revisión.
- Borrar por nombre borra **todos los idiomas** y bloquea el nombre 30 días. Por `hsm_id` se
  borra uno solo.
- El catálogo de estados no es estable (`PENDING` / `IN_REVIEW`, `LIMIT_EXCEEDED`).

## Decisión

### 1. Meta es dueño; la copia de Resender no decide

Resender guarda una copia de cada plantilla: `waba_id`, `name`, `language`, `status`,
`category`, el id de Meta y el **cuerpo**. Sirve para listar y para saber si está aprobada.

El envío **falla abierto**:

- fila presente y no `APPROVED` → `409 template_not_approved`, **sin llamar a Meta**;
- fila ausente → se envía igual y decide Meta.

Una fila ausente es un estado legítimo: una plantilla creada en WhatsApp Manager después del
último sync. Rechazarla sería negarle al cliente un envío válido por una carencia nuestra.

### 2. El cuerpo sí se guarda (cambio respecto de #79)

#79 pedía espejar lo mínimo, sin contenido. Se cambia: el cuerpo **se guarda al sincronizar y al
crear**, para que el Inbox pueda mostrar el texto que se envió. El `status` se mantiene al día por
webhook; el cuerpo **no** se refresca por webhook, así que puede quedar viejo después de una
edición hecha en WhatsApp Manager. Por eso el Inbox muestra el cuerpo guardado **en el mensaje**
(decisión 11) y no el de la copia.

### 3. Identidad `(name, language)`

Al enviar se usan `name` + `language` y no un id: es lo único que Meta acepta. Exponer un id
pondría una traducción obligatoria delante de cada envío, sostenida por una copia que no es la
fuente de verdad.

### 4. Ruta de envío separada

`POST /api/meta/whatsapp/templates/send`.

- `parseOutboundSendInput` **no se toca**: es neutral de canal y lo comparten los tres canales.
- `Idempotency-Key` obligatoria, igual que en `/whatsapp/send`.
- `components` se pasa tal cual a Meta, **sin validar el conteo de parámetros**. Un falso
  rechazo nuestro es peor que uno de Meta, porque contra el nuestro el cliente no puede hacer
  nada.
- Mismos gates que `/whatsapp/send` **menos la ventana de 24 h**, que es justo lo que la
  plantilla existe para saltar.

### 5. El Plan Free puede enviar plantillas

Cada envío que Meta acepta consume 1 de cuota, como cualquier [Mensaje contabilizado]. No hay un
control de plan extra.

### 6. El 409 de ventana cerrada apunta a las plantillas

`/whatsapp/send` mantiene el `409 customer_service_window_closed`, pero
`templateSendingSupported` pasa a `true` y el `message` apunta a
`/api/meta/whatsapp/templates/send`.

### 7. Dueño: `(created_by_tenant_id, created_by_client_account_id)`

El [Cliente] usa el `tenant_id` del [Padre], así que el tenant solo no alcanza para saber de quién
es una plantilla. Las dos columnas llevan `on delete set null`: sin dueño, la plantilla queda de
solo lectura, pero la fila no se borra, porque describe algo que **sigue existiendo en Meta** y
que otro número de la WABA puede estar enviando.

El cliente administra sus plantillas **por la UI**; el padre, **por la API**.

### 8. Visibilidad por WABA

Cada actor ve las plantillas de las WABAs donde tiene un número conectado: el cliente, solo las de
sus números; el padre, todas las del tenant.

- Editar y borrar: **solo las propias**.
- Antes de editar o borrar se avisa si otros números ya enviaron esa plantilla.

Se acepta que se vean entre sí porque conectar un número exige acceso a la WABA en Meta: quien lo
conecta ya las ve en WhatsApp Manager.

Alternativas descartadas:

- **Aislar por dueño.** Es una ficción: Meta deja enviar cualquier plantilla de la WABA, y las
  importadas por el sync no tendrían dueño.
- **Prohibir compartir WABA.** Deja fuera a la agencia que tiene una sola WABA para varios
  clientes.

### 9. Borrado siempre por `hsm_id`

Nunca por `name`: borrar por nombre se lleva todos los idiomas y bloquea el nombre 30 días. Si a
la fila le falta el id de Meta, el borrado se rechaza con un error que lo explica.

### 10. Evento `type: "template"` al webhook del tenant

Cuando cambia el estado de una plantilla:

- se envía a **todas las conexiones activas con `webhookUrl` de esa WABA**;
- respeta la pausa de conexión y la cuenta restringida;
- el `eventId` sale de una fila por cada cambio de estado.

### 11. Inbox

`messages.template_meta` guarda `{ name, language, components, body? }` **de ese envío**, no de
la plantilla. La burbuja muestra el texto completo si hay cuerpo; si no, el nombre y los valores
de las variables. `attachment_type` queda `null`: una [Plantilla] no es un [Adjunto].

### 12. Destinatario de WhatsApp normalizado y conciliado con el `wa_id`

Los entrantes llegan con `from` = `wa_id`: solo dígitos, sin `+`. Si un envío guarda el número
como lo tecleó el cliente (`+52 55 1234 5678`), crea una conversación distinta de la que recibe
la respuesta. Con plantillas escribir primero pasa a ser el caso normal, así que:

- En WhatsApp, `recipientId` se normaliza a dígitos en `resolveSendTarget`, no en
  `parseSendTarget`, que es neutral de canal (en Messenger e Instagram es un PSID o un IGSID).
  Si no quedan entre 8 y 15 dígitos, `400 invalid_recipient`.
- Después del envío se lee `contacts[0].wa_id` de la respuesta de Cloud API. En MX y AR puede no
  coincidir con el número marcado (`52…` contra `521…`). Si difiere, el mensaje va a la
  conversación del `wa_id`: si no existe, la conversación usada pasa a llevarlo; si existe, se
  usa esa y la usada se borra solo si quedó sin mensajes.
- `resender.conversationId` devuelve la conversación final.

La conciliación vive en `lib/outbound/whatsapp-recipient.ts` y la comparten `/whatsapp/send` y el
envío de plantillas.

### 13. Fuera de la v1

Encabezado con media (exige que Resender hospede media saliente, que la ADR 0013 cerró),
plantillas `authentication`, botones, envío masivo, borrado por `name` y administrar plantillas
ajenas.

## Consecuencias

### Deudas declaradas

- **La suscripción `subscribed_fields` de Coexistence puede estar estrechando de más.** Si
  reemplaza en vez de sumar, un número de Coexistence no recibe `messages`. Se verifica en el
  ticket 6 con un `GET /{waba_id}/subscribed_apps` sobre una conexión real.
- **El `template` del catálogo de [Adjunto] colisiona de nombre con [Plantilla].** Es la tarjeta
  con botones de Messenger y no tiene relación. El rename queda pendiente.
- **Las plantillas enviadas desde la WhatsApp Business App todavía no se reconocen.** Llegan como
  eco y se ven como un mensaje más.

### Lo que hay que asumir

- Dos tenants que comparten WABA ven los nombres de las plantillas del otro.
- La copia puede estar desactualizada en el cuerpo; el estado no, mientras el webhook llegue.
- La forma exacta del envío de plantilla hay que confirmarla contra un número real antes de dar
  la entrega por buena.
