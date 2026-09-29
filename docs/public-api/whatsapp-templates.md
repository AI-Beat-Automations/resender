# Plantillas de WhatsApp

> Borrador de documentación pública, listo para portar a docs.resender.dev (repo `resender-docs`).
> Cada dato sale del código de este repo; las rutas de origen se citan en «Notas para portar».
> Lo que no se pudo confirmar en el código está marcado como **Pendiente de confirmar**.

Una **plantilla** es un mensaje de WhatsApp que Meta revisó y aprobó de antemano. Es la única forma
de escribirle a un contacto que **nunca te escribió** o cuya **ventana de atención de 24 horas está
cerrada** (su último mensaje tiene más de 24 horas). Dentro de la ventana puedes seguir
respondiendo con texto libre o adjuntos por `POST /api/meta/whatsapp/send`.

Lo que conviene saber antes de empezar:

- **Identidad: `name` + `language`.** La misma plantilla en tres idiomas son tres plantillas. Al
  enviar solo se usa ese par; Meta no acepta un id en el envío.
- **La plantilla vive en la cuenta de WhatsApp Business (WABA), no en el número.** Todos los
  números de la misma WABA pueden enviar las mismas plantillas, aunque estén conectados en
  cuentas de Resender distintas.
- **Meta es la fuente de verdad.** Resender guarda una copia del catálogo para listarlo y para
  saber si una plantilla está aprobada, pero no decide qué se envía (ver
  [Control de aprobación](#control-de-aprobación)).
- **Costo de Meta.** Meta cobra las plantillas según su categoría y se lo cobra **directo a la
  WABA**, no a través de Resender. Las de `marketing` y `utility` se cobran **desde el primer
  mensaje**, y **no entran en los 1.000 mensajes de servicio gratis al mes** por número, que son
  solo para respuestas libres dentro de la ventana. Sin un método de pago válido en la WABA, Meta
  deja de entregar (ver el error `131042` más abajo).
- **Cuota de Resender.** Cada plantilla que Meta acepta consume 1 mensaje de la cuota de tu plan,
  como cualquier envío. El Plan Free también puede enviar plantillas.

## Obligación de opt-in

Antes de escribirle primero a alguien por WhatsApp **tienes que contar con su opt-in**: la persona
aceptó que tu negocio la contacte por WhatsApp y puedes demostrarlo. Lo exige la
[WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy) y es condición de uso
de Resender (Términos, sección «WhatsApp: opt-in, templates and the 24-hour window»).

Un número conseguido sin consentimiento, comprado, extraído de la web o reutilizado de otro canal
no cuenta como opt-in. Resender no verifica el opt-in por ti: la responsabilidad es tuya.

## Autenticación y controles comunes

Todos los endpoints de esta página usan la misma API key que el resto de la API:

```bash
-H "Authorization: Bearer pk_live_..."
```

Los controles corren en este orden y responden igual en todos los endpoints de plantillas:

| Status | Cuerpo | Cuándo |
|---|---|---|
| `401` | `{"error":"unauthorized"}` | API key inválida, revocada o ausente. |
| `429` | `{"error":"rate_limited"}` + cabecera `retry-after: 60` | Límite por API key excedido (3.000 requests por minuto). |
| `400` | `{"error":"Idempotency-Key is required and must be a non-empty string of at most 200 characters"}` | **Solo en `/templates/send`**: falta `Idempotency-Key` o supera 200 caracteres. |
| `403` | `{"error":"channel_not_enabled","message":"whatsapp channel is not enabled"}` | Tu cuenta no tiene WhatsApp habilitado. |
| `403` | `{"error":"account is on the waitlist"}` | La cuenta está en lista de espera. |
| `402` | `{"error":"quota_exceeded","message":"You used the … messages of …"}` | Agotaste la cuota del período. |
| `403` | `{"error":"page_limit_exceeded","message":"Your plan allows N connections and you have M. …"}` | Tienes más conexiones de las que permite tu plan. |
| `403` | `{"error":"plan_unavailable","message":"We couldn't resolve …"}` | No se pudo resolver tu plan o tu período de facturación. |

La cuenta restringida (`402`/`403` de cuota o de conexiones) bloquea **también** listar, crear,
editar y borrar plantillas, aunque esas operaciones no consuman cuota.

Puedes mandar `x-request-id` para correlacionar la request con los logs.

`pageId` es siempre el **`phone_number_id`** del número de WhatsApp conectado, igual que en
`/api/meta/whatsapp/send`. La WABA la resuelve Resender a partir del número; nunca la mandas tú.

---

## Enviar una plantilla

```
POST /api/meta/whatsapp/templates/send
```

Envía una plantilla aprobada a un contacto. **No mira la ventana de 24 horas**: funciona con la
ventana abierta, cerrada o con un contacto que nunca escribió.

### Cabeceras

| Cabecera | Obligatoria | Descripción |
|---|---|---|
| `Authorization` | Sí | `Bearer pk_live_...` |
| `Idempotency-Key` | **Sí** | 1 a 200 caracteres. En WhatsApp es **obligatoria** (en Messenger e Instagram es opcional): un duplicado le llega al teléfono de tu cliente. Usa un valor por envío lógico, por ejemplo `cita-8841-recordatorio`. |
| `Content-Type` | Sí | `application/json` |
| `x-request-id` | No | Id de correlación para los logs. |

La `Idempotency-Key` es única por cuenta de Resender entre **todos** los mensajes salientes: no
reutilices una key que ya usaste en `/api/meta/whatsapp/send` u otra ruta de envío, porque
recibirías el resultado de ese otro envío.

### Cuerpo

El destino va en una de dos formas, las mismas de `/api/meta/whatsapp/send`, más el objeto
`template`:

**Forma 1: respondiendo a un webhook**, con el `conversation.id` que te llegó en el evento.

```json
{
  "conversationId": "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
  "template": { "name": "hello_world", "language": "en_US" }
}
```

**Forma 2: escribiendo primero**, con el número conectado y el teléfono del contacto.

```json
{
  "pageId": "109876543210987",
  "recipientId": "+54 9 11 1234-5678",
  "template": {
    "name": "pedido_listo",
    "language": "es_AR",
    "components": [
      {
        "type": "body",
        "parameters": [{ "type": "text", "text": "Ana" }]
      }
    ]
  }
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `conversationId` | string (uuid) | Forma 1. Si lo mandas junto con `pageId` + `recipientId`, tiene que coincidir con ese par. |
| `pageId` | string | Forma 2. `phone_number_id` del número conectado. |
| `recipientId` | string | Forma 2. Teléfono del contacto en formato internacional, **con código de país**. Se aceptan `+`, espacios y guiones; Resender deja solo los dígitos. Tiene que quedar entre 8 y 15 dígitos. |
| `template.name` | string | Nombre exacto de la plantilla en WhatsApp Manager. |
| `template.language` | string | Código de idioma exacto, por ejemplo `en_US`, `es_MX`, `es_AR`. |
| `template.components` | array | Opcional. Los valores de las variables, en el formato de `components` de la Cloud API de Meta. Resender solo valida que sea un array y lo **pasa tal cual** a Meta, sin contar parámetros. Omítelo en plantillas sin variables. |

Si mandas un cuerpo de `/send` (con `reply` o `attachment`) a esta ruta, responde
`400 template_missing`.

### Ejemplo

```bash
curl https://resender.dev/api/meta/whatsapp/templates/send \
  -H "Authorization: Bearer pk_live_..." \
  -H "Idempotency-Key: pedido-5521-listo" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "109876543210987",
    "recipientId": "5491112345678",
    "template": {
      "name": "pedido_listo",
      "language": "es_AR",
      "components": [
        { "type": "body", "parameters": [{ "type": "text", "text": "Ana" }] }
      ]
    }
  }'
```

### Respuesta exitosa

`200`, con la misma forma que `/api/meta/whatsapp/send`. `meta` es la respuesta de la Cloud API
tal cual.

```json
{
  "meta": {
    "messaging_product": "whatsapp",
    "contacts": [{ "input": "5491112345678", "wa_id": "5491112345678" }],
    "messages": [{ "id": "wamid.HBgNNTQ5MTExMjM0NTY3OBUCABEYEjQ..." }]
  },
  "resender": {
    "conversationId": "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
    "messageId": "0c9d2f6e-3b7a-4e1d-8f5c-2a1b3c4d5e6f",
    "status": "sent"
  }
}
```

- `resender.conversationId` es la conversación **final**. Meta puede devolver un `wa_id` distinto
  del número que marcaste (pasa en México y Argentina: `52…` contra `521…`). En ese caso Resender
  guarda el mensaje en la conversación de ese `wa_id`, que es donde va a llegar la respuesta del
  contacto. Usa siempre el `conversationId` de la respuesta, no uno que hayas calculado.
- Solo consume cuota un envío que Meta aceptó.

### Replay idempotente

Si repites una `Idempotency-Key` ya usada, Resender **no vuelve a llamar a Meta ni consume
cuota**: responde `200` con el resultado guardado y `resender.idempotentReplay: true`.

```json
{
  "meta": { "messages": [{ "id": "wamid.HBgNNTQ5MTExMjM0NTY3OBUCABEYEjQ..." }] },
  "resender": {
    "conversationId": "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
    "messageId": "0c9d2f6e-3b7a-4e1d-8f5c-2a1b3c4d5e6f",
    "status": "sent",
    "idempotentReplay": true
  }
}
```

- El replay responde **`200` también si el envío original falló**: en ese caso trae
  `status: "failed"` y el `error` guardado. Para reintentar un envío fallido, usa una key nueva.
- El replay corre **antes** de leer el cuerpo: con una key repetida recibes el resultado original
  aunque el cuerpo sea distinto.
- Los controles de acceso (canal, lista de espera, cuota) corren **antes** del replay: si la cuenta
  quedó restringida, una key repetida también recibe el `402`/`403`.
- Dos requests simultáneas con la misma key producen un solo envío; la segunda recibe el replay.

### Control de aprobación

Antes de llamar a Meta, Resender busca la plantilla (`name` + `language`) en su copia del catálogo
de la WABA:

- Si la copia la tiene y **no** está `APPROVED` → `409 template_not_approved`, **sin llamar a
  Meta** y sin consumir cuota.
- Si la copia la tiene `APPROVED` → se envía.
- Si la copia **no la conoce** (por ejemplo, la creaste en WhatsApp Manager hace un momento) → se
  envía igual y decide Meta. Si Meta la rechaza, verás el error `132001` de la tabla de abajo.

```json
{
  "code": "template_not_approved",
  "error": "The template \"pedido_listo\" (es_AR) is PENDING in WhatsApp, not APPROVED, so it can't be sent yet.",
  "templateStatus": "PENDING"
}
```

`templateStatus` puede ser `PENDING`, `IN_REVIEW`, `REJECTED`, `PAUSED`, `DISABLED`, `IN_APPEAL`,
`LIMIT_EXCEEDED`, `PENDING_DELETION`, `DELETED`, `ARCHIVED` o `unknown` (un estado que Meta
mandó y Resender no reconoce; también se rechaza).

### Errores de Resender

Todos responden **sin llamar a Meta** y sin consumir cuota.

| Status | `code` | `error` | Causa |
|---|---|---|---|
| `400` | — | `invalid json` | El cuerpo no es JSON. |
| `400` | — | `invalid body` | El cuerpo no es un objeto. |
| `400` | — | `invalid conversationId` | `conversationId` vacío o no es string. |
| `400` | `send_destination_missing` | `missing destination: send conversationId, or pageId and recipientId` | No hay destino. |
| `400` | `send_destination_incomplete` | `missing recipientId: …` / `missing pageId: …` | Mandaste solo uno de `pageId` y `recipientId`. |
| `400` | `template_missing` | `missing template: send { name, language, components? }` | Falta el objeto `template`. |
| `400` | `template_name_missing` | `missing template.name` | |
| `400` | `template_language_missing` | `missing template.language (for example en_US)` | |
| `400` | `template_components_invalid` | `template.components must be an array` | |
| `400` | `invalid_recipient` | `recipientId must be a phone number in international format (country code included): 8 to 15 digits, with or without "+", spaces or dashes` | El teléfono no queda entre 8 y 15 dígitos. |
| `400` | `conversation_channel_mismatch` | `conversation belongs to messenger; use /api/meta/send` | El `conversationId` es de otro canal. |
| `400` | — | `conversationId does not match pageId and recipientId` | Forma 2 con un `conversationId` que no corresponde al par. |
| `404` | — | `conversation not found` | El `conversationId` no existe en tu cuenta. |
| `404` | — | `WhatsApp number is not connected for this tenant` | El `pageId` (o el número de la conversación) no es un número activo de tu cuenta. |
| `409` | `template_not_approved` | ver arriba | La copia sabe que la plantilla no está aprobada. Trae `templateStatus`. |

### Errores de Meta

Si Meta rechaza el envío, la respuesta tiene **el mismo status HTTP que devolvió Meta** y la misma
forma que un éxito, más `error`. El mensaje **se guarda igual** con `status: "failed"` y **no
consume cuota**.

```json
{
  "error": "This template doesn't exist in the requested language or isn't approved yet. Check the exact template name and language code (e.g. en_US) in WhatsApp Manager, and that its status is Active.",
  "meta": {
    "error": {
      "message": "(#132001) Template name does not exist in the translation",
      "type": "OAuthException",
      "code": 132001,
      "fbtrace_id": "A1b2C3d4E5f6"
    }
  },
  "resender": {
    "conversationId": "6f0e5a2c-8a5e-4a3d-9c2b-1f2e3d4c5b6a",
    "messageId": "0c9d2f6e-3b7a-4e1d-8f5c-2a1b3c4d5e6f",
    "status": "failed"
  }
}
```

**Para distinguir el caso, lee `meta.error.code`.** En los rechazos de envío de plantillas la
respuesta **no trae un `code` propio de Resender**: Resender traduce el mensaje a `error` y deja el
código de Meta en `meta.error.code`. Si Meta devuelve un código que Resender no traduce, `error`
lleva el mensaje original de Meta.

| `meta.error.code` | Qué significa | Qué hacer |
|---|---|---|
| `132001` | La plantilla no existe en ese idioma o no está aprobada. | Revisa el nombre y el código de idioma exactos en WhatsApp Manager y que el estado sea Activa. |
| `132000` | La cantidad de parámetros no coincide con las variables de la plantilla. | Manda un valor por cada variable `{{n}}`, en orden. |
| `132005` | El texto queda demasiado largo al completar los parámetros. | Acorta los valores. |
| `132012` | Un parámetro no tiene el formato que la variable espera (moneda, fecha, media). | Corrige tipos y valores. |
| `132007` | El contenido de la plantilla viola una política de WhatsApp. | Edítala en WhatsApp Manager y reenvíala a revisión. |
| `132015` | Meta **pausó** la plantilla por baja calidad. | Edítala y reenvíala, o usa otra aprobada mientras tanto. |
| `132016` | Meta la **deshabilitó** para siempre tras varias pausas. | Crea una plantilla nueva con otro contenido. |
| `131050` | El contacto **se dio de baja** de los mensajes de marketing de tu negocio. | No le reenvíes plantillas de marketing. Las de utilidad o autenticación, o una respuesta cuando escriba, sí pueden llegar. |
| `131049` | Meta no entregó el marketing para no saturar al contacto. | Espera al menos 24 horas antes de mandarle otra plantilla de marketing. |
| `131048` | Meta limita cuántos mensajes puede enviar el número (calidad o límite de mensajería). | Revisa la calidad y el límite del número en WhatsApp Manager. |
| `131056` | Demasiados mensajes al mismo contacto en poco tiempo. | Espera antes de volver a escribirle; otros contactos no se ven afectados. |
| `131026` | Mensaje no entregable: el destinatario puede no tener WhatsApp, tener una versión vieja o no poder recibir de este negocio. | Verifica el número. |
| `131042` | La WABA no tiene un método de pago válido. Meta cobra los mensajes de WhatsApp directo a la tarjeta de la WABA, no a través de Resender. | Agrega o corrige el método de pago en la configuración de pagos de Meta Business y vuelve a enviar. |
| `131031` | La cuenta de WhatsApp Business está bloqueada o deshabilitada. | Revisa el estado en WhatsApp Manager; no es reintentable. |
| `368` | La WABA está bloqueada temporalmente por una infracción de política. | Resuélvelo del lado de Meta. |
| `130429`, `4`, `17`, `32`, `613` | Límite de tasa de Meta para la app o el número. | Reintenta más tarde con backoff. |
| `190` | El token de la WABA venció o fue revocado. Resender marca la conexión como inválida. | Reconecta el número en Resender. |

Si Resender no logra contactar a la Cloud API (error de red o timeout), responde `502` con
`error: "Could not reach WhatsApp's Cloud API (network error or timeout). Retry shortly."`.

---

## Listar plantillas

```
GET /api/meta/whatsapp/templates?pageId=<phone_number_id>
```

Devuelve el catálogo de la WABA del número. **Lee la copia de Resender, no llama a Meta** y no
consume cuota. No requiere `Idempotency-Key`.

La copia se llena al conectar el número y se mantiene al día con los webhooks de estado de Meta.
Una plantilla que todavía no aparece acá **se puede enviar igual** (ver
[Control de aprobación](#control-de-aprobación)).

**Visibilidad.** Ves **todas** las plantillas de la WABA del número, incluidas las que se crearon
en WhatsApp Manager, las que crearon tus clientes desde la consola y las de otras cuentas de
Resender que comparten esa WABA. Conectar un número exige acceso a la WABA en Meta, así que quien
lo conecta ya las ve en WhatsApp Manager.

```bash
curl "https://resender.dev/api/meta/whatsapp/templates?pageId=109876543210987" \
  -H "Authorization: Bearer pk_live_..."
```

```json
{
  "templates": [
    {
      "id": "3a1f0c2e-7b6d-4e5f-9a8b-1c2d3e4f5a6b",
      "name": "hello_world",
      "language": "en_US",
      "category": "utility",
      "status": "APPROVED",
      "body": "Hello World",
      "own": false
    },
    {
      "id": "8e7d6c5b-4a3f-4e2d-9c1b-0a9f8e7d6c5b",
      "name": "aviso_de_cita",
      "language": "es_MX",
      "category": "utility",
      "status": "PENDING",
      "body": "Hola {{1}}, tu cita es mañana.",
      "own": true
    }
  ]
}
```

Ordenado por `name` y `language`.

| Campo | Descripción |
|---|---|
| `id` | Id de Resender (uuid). Es el que usas en `PATCH` y `DELETE`. **No** es el id de Meta. |
| `name`, `language` | La identidad de la plantilla; lo que mandas al enviar. |
| `category` | `utility`, `marketing`, `authentication` o `null` si no se conoce. |
| `status` | `APPROVED`, `PENDING`, `IN_REVIEW`, `REJECTED`, `PAUSED`, `DISABLED`, `IN_APPEAL`, `LIMIT_EXCEEDED`, `PENDING_DELETION`, `DELETED`, `ARCHIVED` o `unknown`. |
| `body` | Texto del cuerpo con sus `{{n}}` sin reemplazar, o `null`. Se guarda al sincronizar y al crear; **no se refresca** si alguien edita la plantilla en WhatsApp Manager. |
| `own` | `true` si la creaste tú por la API. Solo las `own: true` se pueden editar y borrar. |

| Status | Cuerpo | Causa |
|---|---|---|
| `400` | `{"error":"pageId is required"}` | Falta `pageId`. |
| `404` | `{"error":"whatsapp number is not connected"}` | El `pageId` no es un número activo de tu cuenta (no se dice si existe en otra). |

---

## Crear una plantilla

```
POST /api/meta/whatsapp/templates
```

Crea la plantilla en Meta y la envía a revisión. No requiere `Idempotency-Key`: si repites el
mismo `name` + `language`, lo rechaza Meta.

Alcance de la v1: cuerpo con variables posicionales `{{1}}…{{n}}` y pie opcional, en las
categorías `utility` y `marketing`. Encabezados con media, botones y plantillas de
`authentication` no se pueden crear por la API (sí puedes enviarlas si ya existen en la WABA).

```json
{
  "pageId": "109876543210987",
  "name": "aviso_de_cita",
  "language": "es_MX",
  "category": "utility",
  "body": {
    "text": "Hola {{1}}, tu cita es mañana.",
    "examples": ["Ana"]
  },
  "footer": "Clínica"
}
```

| Campo | Reglas |
|---|---|
| `pageId` | Obligatorio. `phone_number_id` de un número activo de tu cuenta. |
| `name` | 1 a 512 caracteres: minúsculas, números y `_`. |
| `language` | Código de idioma de WhatsApp: 2–3 letras y variante opcional (`en_US`, `es`, `es_MX`, `pt_BR`). Meta decide si el código existe. |
| `category` | `utility` o `marketing` (sin distinguir mayúsculas). |
| `body.text` | Obligatorio, hasta 1.024 caracteres. Variables `{{1}}…{{n}}` consecutivas desde `{{1}}` (se pueden repetir). No puede empezar ni terminar con una variable. |
| `body.examples` | Array con **exactamente un ejemplo por variable**, ninguno vacío. Meta rechaza sin revisión una plantilla con variables sin ejemplo. Omítelo o manda `[]` si no hay variables. |
| `footer` | Opcional, hasta 60 caracteres, sin variables. |

Respuesta `201`. La plantilla queda a tu nombre (`own: true`) con el estado que devolvió Meta,
casi siempre `PENDING`. Te enteras de la aprobación por el
[evento `type: "template"`](#evento-de-webhook-type-template).

```json
{
  "template": {
    "id": "8e7d6c5b-4a3f-4e2d-9c1b-0a9f8e7d6c5b",
    "name": "aviso_de_cita",
    "language": "es_MX",
    "category": "utility",
    "status": "PENDING",
    "body": "Hola {{1}}, tu cita es mañana.",
    "own": true
  }
}
```

---

## Editar una plantilla

```
PATCH /api/meta/whatsapp/templates/{id}
```

`{id}` es el `id` de Resender del listado. Reemplaza el **contenido** en Meta. El nombre, el idioma
y la categoría no se editan.

```json
{
  "pageId": "109876543210987",
  "body": { "text": "Hola {{1}}, nos vemos mañana.", "examples": ["Ana"] },
  "footer": "Clínica"
}
```

`body` y `footer` siguen las mismas reglas que al crear. Si omites `footer`, la plantilla queda
sin pie (el contenido se reemplaza entero).

Respuesta `200`:

```json
{
  "template": {
    "id": "8e7d6c5b-4a3f-4e2d-9c1b-0a9f8e7d6c5b",
    "name": "aviso_de_cita",
    "language": "es_MX",
    "category": "utility",
    "status": "PENDING",
    "body": "Hola {{1}}, nos vemos mañana.",
    "own": true
  },
  "reviewRequired": true,
  "usedByOtherNumbers": 3
}
```

- **Toda edición vuelve a revisión**: la copia queda `PENDING` hasta que Meta avise.
- `reviewRequired: true` significa que la plantilla **estaba `APPROVED`** y la edición la sacó de
  aprobada: **no se puede enviar** hasta que Meta la apruebe otra vez (mientras tanto el envío
  responde `409 template_not_approved`). Es `false` si ya no estaba aprobada.
- `usedByOtherNumbers`: cuántos números de la misma WABA **fuera de tu cuenta** ya enviaron esta
  plantilla (`name` + `language`). La plantilla es de la WABA, así que editarla también los afecta.
  **Informa, no bloquea.**

---

## Borrar una plantilla

```
DELETE /api/meta/whatsapp/templates/{id}?pageId=<phone_number_id>
```

Borra **solo ese idioma**. Resender borra siempre por el id de Meta (`hsm_id`) y **nunca por
nombre**: borrar por nombre se llevaría todos los idiomas y bloquearía el nombre 30 días. Si
Resender todavía no tiene el id de Meta de la plantilla, no la borra y responde
`409 template_missing_meta_id`.

```bash
curl -X DELETE \
  "https://resender.dev/api/meta/whatsapp/templates/8e7d6c5b-4a3f-4e2d-9c1b-0a9f8e7d6c5b?pageId=109876543210987" \
  -H "Authorization: Bearer pk_live_..."
```

Respuesta `200`:

```json
{
  "deleted": true,
  "template": {
    "id": "8e7d6c5b-4a3f-4e2d-9c1b-0a9f8e7d6c5b",
    "name": "aviso_de_cita",
    "language": "es_MX",
    "category": "utility",
    "status": "PENDING",
    "body": "Hola {{1}}, nos vemos mañana.",
    "own": true
  },
  "usedByOtherNumbers": 2
}
```

`template` es la plantilla tal como estaba antes de borrarla. `usedByOtherNumbers` significa lo
mismo que en `PATCH`.

---

## Quién puede editar y borrar

Cada plantilla creada desde Resender guarda a su dueño: la cuenta (tenant) y, si la creó un cliente
desde la consola, ese cliente.

- **La API actúa siempre como la cuenta principal** (el «padre»), nunca como uno de sus clientes.
- Por la API **solo puedes editar y borrar las plantillas que creaste por la API** (`own: true`).
- Son de **solo lectura** por la API, y responden `403 template_not_owned`:
  - las importadas del catálogo de Meta (por ejemplo `hello_world` o las creadas en WhatsApp
    Manager), que no tienen dueño;
  - las que creó uno de tus clientes desde la consola de Resender (cada cliente administra las
    suyas desde la consola);
  - las de otra cuenta de Resender que comparte la WABA.

  Edítalas en WhatsApp Manager.
- Cualquier plantilla de la WABA, propia o no, **se puede enviar**.

## Errores de crear, editar y borrar

| Status | `code` | `error` | Causa |
|---|---|---|---|
| `400` | — | `invalid json` | El cuerpo no es un objeto JSON (`POST`, `PATCH`). |
| `400` | — | `pageId is required` | Falta `pageId`. |
| `400` | `template_name_invalid` | `name must be 1-512 characters of lowercase letters, numbers and underscores (for example order_update)` | Solo `POST`. |
| `400` | `template_language_invalid` | `language must be a WhatsApp language code (for example en_US or es_MX)` | Solo `POST`. |
| `400` | `template_category_invalid` | `category must be one of: utility, marketing` | Solo `POST`. |
| `400` | `template_body_missing` | `missing body: send { text, examples } with one example per {{n}}` | |
| `400` | `template_body_too_long` | `body.text is longer than 1024 characters` | |
| `400` | `template_variable_invalid` | `{{x}} is not a valid variable: use {{1}}, {{2}}, …` | |
| `400` | `template_variables_not_sequential` | `variables must be consecutive starting at {{1}}: {{2}} is missing` | |
| `400` | `template_variable_at_edge` | `body.text can't start or end with a variable: add some text before and after it` | |
| `400` | `template_examples_mismatch` | `body.examples must be an array with exactly one example per variable (N)` | |
| `400` | `template_example_empty` | `body.examples[0] is empty: …` | |
| `400` | `template_footer_invalid` | `footer must be text of up to 60 characters, without variables` | |
| `404` | — | `whatsapp number is not connected` | El `pageId` no es un número activo de tu cuenta. |
| `404` | `template_not_found` | `template not found` | `PATCH`/`DELETE`: el `id` no existe o es de otra WABA (misma respuesta en los dos casos). |
| `403` | `template_not_owned` | `This template wasn't created from this Resender account, so it can't be changed here: edit it in WhatsApp Manager.` | `PATCH`/`DELETE` de una plantilla que no es tuya. |
| `409` | `template_missing_meta_id` | `We don't have this template's WhatsApp id yet. Deleting it by name would delete it in every language, so it wasn't changed. Try again in a few minutes, or manage it in WhatsApp Manager.` | `PATCH`/`DELETE` sin id de Meta. No se llama a Meta. |

Las validaciones y los chequeos de número, existencia y dueño ocurren **antes** de llamar a Meta.

**Rechazos de Meta.** Status de Meta (un `5xx` de Meta se devuelve como `502`), con esta forma.
Ojo: acá `meta` trae solo el código y el subcódigo, no la respuesta completa de Graph.

```json
{
  "code": "template_under_review",
  "error": "WhatsApp is still reviewing this template, so it can't be edited yet. Try again when the review finishes.",
  "meta": { "code": 100, "subcode": 2388039 }
}
```

| `meta.subcode` | `code` | Significado |
|---|---|---|
| `2388019` | `template_limit_reached` | La WABA llegó al máximo de plantillas (250 sin verificar, hasta 6.000 verificada). |
| `2388039` | `template_under_review` | Todavía está en revisión; no se puede editar. |
| `2388040` | `template_invalid_format` | Un campo supera el largo permitido. |
| `2388072` | `template_invalid_format` | Meta rechazó el formato del cuerpo. |
| `2388073` | `template_invalid_format` | Meta rechazó el formato del pie. |
| `2388293` | `template_invalid_format` | Demasiadas variables para el largo del texto. |
| `2388299` | `template_invalid_format` | Una variable al principio o al final del cuerpo. |

Cualquier otro rechazo (nombre duplicado, nombre bloqueado por un borrado reciente, límites de
creación o de ediciones) llega **sin `code`**, con el mensaje de Meta en `error`. Un token vencido
(`meta.code: 190`) llega sin `code` y con el mensaje de reconectar el número. Si Resender no llega a
Meta: `502` con `{"error":"We couldn't reach WhatsApp. Try again in a moment.","meta":{"code":null,"subcode":null}}`.

---

## Cambio en `409 customer_service_window_closed`

`POST /api/meta/whatsapp/send` sigue rechazando el texto libre y los adjuntos con la ventana de
24 horas cerrada, **sin llamar a Meta**. Lo que cambia es que ahora apunta al envío de plantillas:
`templateSendingSupported` pasa de `false` a `true` y el `message` nombra la ruta.

```json
{
  "error": "customer_service_window_closed",
  "requiresTemplate": true,
  "templateSendingSupported": true,
  "message": "This contact hasn't messaged the number in the last 24 hours, so WhatsApp only accepts approved template messages. Send one with POST /api/meta/whatsapp/templates/send, or wait for the contact to write again."
}
```

Reintentar en `/send` no va a funcionar hasta que el contacto escriba. Para escribirle ahora, manda
una plantilla con el mismo destino (`conversationId`, o `pageId` + `recipientId`) a
`POST /api/meta/whatsapp/templates/send`, con una `Idempotency-Key` nueva.

---

## Evento de webhook `type: "template"`

Cuando Meta cambia el estado de una plantilla (aprobada, rechazada, pausada, deshabilitada…),
Resender hace `POST` a la Webhook URL de **cada conexión de WhatsApp activa con Webhook URL de esa
WABA**, de cualquier cuenta de Resender. Es decir: lo recibes por cada número tuyo de esa WABA, y
también por plantillas que no creaste tú.

- Solo se emite cuando el estado **cambia de verdad**. Un webhook repetido de Meta con el mismo
  estado no genera evento.
- `FLAGGED`, `LOCKED` y `UNARCHIVED` de Meta no generan evento. `REINSTATED` llega como
  `APPROVED`.
- Los cambios de categoría y de calidad no generan evento.
- Si la conexión está pausada o la cuenta está restringida (cuota agotada o demasiadas
  conexiones), el evento no se entrega.

### Payload

```json
{
  "type": "template",
  "tenant": { "id": "2b7f2a1c-0d3e-4f5a-9b6c-7d8e9f0a1b2c" },
  "page": {
    "id": "5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f",
    "channel": "whatsapp",
    "metaPageId": "109876543210987",
    "name": "Clínica Centro",
    "username": null,
    "phoneNumberId": "109876543210987",
    "wabaId": "102938475610293",
    "onboardingMode": "standard"
  },
  "template": {
    "name": "aviso_de_cita",
    "language": "es_MX",
    "status": "APPROVED",
    "category": "utility",
    "reason": null
  }
}
```

| Campo | Descripción |
|---|---|
| `type` | Siempre `"template"`. Úsalo para distinguirlo de `"message"` en el mismo endpoint. |
| `tenant.id` | Tu cuenta. |
| `page` | La conexión que recibe **esta** entrega; el mismo `page` que en los eventos `message` de WhatsApp. `phoneNumberId` es igual a `metaPageId`. `onboardingMode` es `standard`, `coexistence` o `null`. |
| `template.name`, `template.language` | La identidad de la plantilla. |
| `template.status` | El estado nuevo, **tal como lo manda Meta**, en mayúsculas (`APPROVED`, `REJECTED`, `PAUSED`, `DISABLED`, `PENDING_DELETION`, `ARCHIVED`…). No está normalizado a la lista del listado. |
| `template.category` | `utility`, `marketing`, `authentication` o `null`. |
| `template.reason` | El motivo de Meta, por ejemplo `INVALID_FORMAT` en un rechazo o `FIRST_PAUSE` en una pausa; `null` si no hay. |

El payload **no trae** un id de plantilla de Resender ni el estado anterior.

### Firma

Si la conexión tiene un secreto de firma (`whsec_…`), cada entrega lleva tres cabeceras, las mismas
que en los eventos de mensajes:

| Cabecera | Valor |
|---|---|
| `resender-event-id` | Id del evento. |
| `resender-timestamp` | Epoch en segundos del momento de la firma. |
| `resender-signature` | `v1=` + HMAC-SHA256 en hexadecimal de `"{resender-event-id}.{resender-timestamp}.{cuerpo crudo}"`, con el secreto como clave. |

Verifica sobre el **cuerpo crudo** (antes de parsear el JSON), compara en tiempo constante y
rechaza timestamps con más de 300 segundos de diferencia. Sin secreto configurado, el request sale
solo con `Content-Type: application/json` y **sin** estas tres cabeceras.

```js
import { createHmac, timingSafeEqual } from "node:crypto"

function verifyResenderSignature({ secret, eventId, timestamp, rawBody, signature }) {
  const expected =
    "v1=" +
    createHmac("sha256", secret)
      .update(`${eventId}.${timestamp}.${rawBody}`)
      .digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  return timingSafeEqual(a, b)
}
```

### Deduplicación por `eventId`

Deduplica por `resender-event-id`. Es **determinista**: sale del cambio de estado y de la conexión
que recibe la entrega, así que los reintentos repiten el mismo id y cada número tuyo de la WABA
recibe un id distinto para el mismo cambio.

En los eventos de plantilla el formato es `evt_<32 hex>_<32 hex>`
(por ejemplo `evt_0189a1b2c3d44e5f8a9b0c1d2e3f4a5b_7c6d5e4f3a2b41c0d9e8f7a6b5c4d3e2`), más largo que
el `evt_<32 hex>` de los mensajes. No valides el id contra un patrón fijo.

### Entrega y reintentos

Igual que los demás eventos: un `2xx` cierra la entrega (el cuerpo se ignora). `408`, `429`, `5xx`,
timeout (5 s) y errores de red se reintentan hasta cinco veces con esperas de 5 s, 30 s, 120 s,
300 s y 900 s (6 intentos en total). Cualquier otro `4xx` es definitivo.

---

## Pendiente de confirmar

- **Forma exacta de `meta` en el envío.** El ejemplo de respuesta exitosa (`messaging_product`,
  `contacts`, `messages`) es la forma documentada de la Cloud API; el código solo lee
  `messages[0].id` y `contacts[0].wa_id`. La ADR 0024 pide confirmar la forma del envío de
  plantilla contra un número real antes de darla por buena. Lo mismo para el ejemplo de error
  (`type`, `fbtrace_id`).
- **Status HTTP de cada error de Meta.** Resender devuelve el status que devuelva Meta; el código no
  fija cuál es para cada `meta.error.code` (el test solo cubre un `400` con `132001`).
- **`eventId` sin firma.** El id del evento solo viaja en la cabecera `resender-event-id`, que sale
  únicamente si la conexión tiene secreto de firma; el payload no lo incluye. Sin secreto no hay
  forma de deduplicar por `eventId`. Confirmar si se quiere documentar así o agregar el id al
  cuerpo.
- **Precios de Meta.** Lo de marketing/utilidad desde el primer mensaje y el cupo de 1.000 sale de
  la ADR 0023, no del código.
- **Límite de 3.000 requests por minuto.** Sale del comentario del rate limiter; el valor real vive
  en la configuración del binding de Cloudflare (`wrangler.jsonc`), que no se revisó.

## Notas para portar

`resender-docs` **no tiene hoy ninguna página ni entrada de OpenAPI de WhatsApp**: el
`openapi.yaml` (versión `2026-09-10`) solo cubre Messenger, Instagram Direct, comentarios de
Instagram y los webhooks `messengerEvents` / `instagramEvents`. Antes de esta página falta
documentar `POST /api/meta/whatsapp/send` y el evento `message` de WhatsApp.

Propuesta de mapeo:

- `openapi.yaml`
  - Nuevos tags: `WhatsApp` y `WhatsApp Templates`. Actualizar `info.description` (hoy dice
    «Messenger e Instagram»).
  - `paths`: `/api/meta/whatsapp/templates/send` (`sendWhatsappTemplate`),
    `/api/meta/whatsapp/templates` (`listWhatsappTemplates`, `createWhatsappTemplate`),
    `/api/meta/whatsapp/templates/{id}` (`editWhatsappTemplate`, `deleteWhatsappTemplate`).
  - `webhooks`: `whatsappTemplateEvents` (`TemplateEvent`), junto al futuro
    `whatsappEvents`.
  - `components.parameters.IdempotencyKey` hoy es `required: false` y dice que es opcional: hace
    falta una variante `required: true` para WhatsApp.
  - `components.parameters.ResenderEventId` tiene `pattern: "^evt_[0-9a-f]{32}$"`, que **no
    acepta** el id de los eventos de plantilla (`evt_<32>_<32>`). Ajustar el patrón.
  - Respuestas nuevas: `409 TemplateNotApproved`, `403 TemplateNotOwned`,
    `404 TemplateNotFound`, `409 TemplateMissingMetaId`, `400 InvalidRecipient`, y el
    `409 CustomerServiceWindowClosed` de `/whatsapp/send`.
- `content/docs/api/`: páginas generadas por Fumadocs (`sendWhatsappTemplate.mdx`,
  `listWhatsappTemplates.mdx`, `createWhatsappTemplate.mdx`, `editWhatsappTemplate.mdx`,
  `deleteWhatsappTemplate.mdx`, `whatsappTemplateEvents.mdx`) y una sección
  `---WhatsApp---` en `content/docs/api/meta.json`. Las secciones narrativas de esta página
  (opt-in, costo de Meta, control de aprobación, dueños, tabla de errores de Meta) van en las
  `description` del OpenAPI o en una guía en `content/docs/(tutoriales)/`.
- `content/docs/api/index.mdx`: agregar la tarjeta de WhatsApp y matizar la convención
  «`Idempotency-Key` es opcional», que no vale para WhatsApp.
- Estilo: el sitio actual usa voseo («Deduplicá», «Verificá»); este borrador está en tú. Unificar al
  portar.

Fuentes en este repo: `app/api/meta/whatsapp/templates/send/route.ts`,
`lib/outbound/template-send-request.ts`, `lib/outbound/send-request.ts`,
`lib/outbound/whatsapp-send-gates.ts`, `lib/whatsapp-templates/send-gate.ts`,
`lib/outbound/resolve-send-target.ts`, `lib/outbound/whatsapp-recipient.ts`,
`lib/meta/whatsapp-client.ts` (`explainWhatsappError`), `app/api/meta/whatsapp/templates/route.ts`,
`app/api/meta/whatsapp/templates/[id]/route.ts`, `lib/whatsapp-templates/template-admin.ts`,
`lib/whatsapp-templates/template-admin-http.ts`, `lib/whatsapp-templates/template-draft.ts`,
`lib/whatsapp-templates/template-store.ts`, `lib/meta/whatsapp-template-client.ts`,
`app/api/meta/whatsapp/send/route.ts`, `lib/inbound/whatsapp-template-ingestion.ts`,
`lib/inbound/external-push.ts`, `lib/inbound/webhook-delivery.ts`,
`lib/pages/webhook-signing.ts`, `lib/billing/entitlements.ts`,
`docs/adr/0023-costo-de-meta-se-informa-no-se-cobra.md`, `docs/adr/0024-plantillas-de-whatsapp.md`.
