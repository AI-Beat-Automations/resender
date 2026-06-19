# Context

## Canonical Terms

### Auth.js
La autenticación web de Resender en Next.js se implementa con `Auth.js`.
El MVP expone páginas separadas de autenticación: `/login` y `/register`.
Tras `login` o `register`, el usuario aterriza en `/connections` para continuar el onboarding conectando Facebook.
Las rutas protegidas redirigen a `/login` cuando el usuario no esta autenticado.
Si un usuario autenticado entra a `/login` o `/register`, se redirige a `/connections`.

### Landing
La ruta `/` sigue siendo una landing pública simple con la propuesta de valor y accesos a `Login` y `Register`.

### Registro MVP
En el MVP, el registro con email y password deja entrar al usuario inmediatamente. No se exige verificación de email antes de usar la app.

### API Token
La integración externa (N8N/IA) no reutiliza la sesión web. Se autentica con una API key opaca separada emitida por Resender para el tenant.

### API Tokens en Settings
Las API keys opacas se crean y gestionan desde `Settings`. En el MVP puede haber múltiples tokens por tenant y cada uno tiene un `label` descriptivo elegido por el usuario.
Los tokens viven hasta revocación manual; no expiran automáticamente en el MVP.
La persistencia de tokens API debe ser con hash, no guardando la credencial completa en texto claro.
El formato visible recomendado es `pk_live_<secretoAleatorio>` o equivalente: un prefijo legible más un secreto aleatorio. En base de datos solo se guarda el hash del secreto.
Para la API externa del MVP no se usan JWTs; la unica credencial aceptada es una API key opaca tipo `Bearer pk_live_<secreto>`.

### Tenant
En el MVP, `tenantId = userId` de nuestra autenticación.

### Usuario MVP
El usuario del MVP tiene un modelo mínimo: `id`, `email`, `passwordHash` y `createdAt`, salvo los campos extra estrictamente necesarios para integrar `Auth.js`.
El registro MVP valida email y exige solo password con longitud minima de 8 caracteres.
El MVP no incluye recuperacion de password.
En `login`, los errores son genericos. En `register`, el email duplicado se informa de forma explicita.

### Ownership de páginas
Una página de Facebook conectada pertenece a un solo tenant. Si otro usuario intenta conectar una página ya asociada a otra cuenta, el sistema debe bloquear la operación; no hay transferencia automática de ownership en el MVP.

### Páginas conectadas por tenant
En el MVP, cada usuario/tenant puede conectar múltiples páginas de Facebook.
Cuando Meta devuelve varias páginas en el callback, el MVP conecta automáticamente todas las páginas autorizadas para ese mismo tenant.

### Reconexión de páginas
Si una página ya conectada pertenece al mismo tenant y se vuelve a autorizar en Meta, la reconexión es idempotente: actualiza token, nombre y `updatedAt`.

### Desconexión de páginas
Desconectar una página elimina o desactiva la conexión para futuros envíos y recepciones, pero conserva el historial de conversaciones y mensajes como bitácora.

### Entrega de entrantes al sistema externo
El MVP usa `push`: tras persistir un mensaje entrante, Resender lo reenvía de forma no bloqueante al sistema externo del tenant.
La URL de destino externo se configura por página. Si una página no tiene `webhookUrl`, el mensaje entrante se persiste igual y aparece en la bitácora, pero no se reenvía.
El payload reenviado al sistema externo incluye contexto minimo pero rico de `tenant`, `page`, `conversation` y `message`.

### API externa de salida
La API externa de salida usa API key opaca por header `Authorization: Bearer ...`.
`POST /api/meta/send` recibe `pageId`, `recipientId`, `reply` y puede recibir `conversationId` opcional para facilitar persistencia y auditoria del mensaje saliente.
Si `conversationId` viene informado, debe coincidir con `pageId` y `recipientId`; si no coincide, la request se rechaza con `400`.
Los mensajes salientes se persisten tanto en exito como en fallo, usando `status` para distinguir el resultado del envio.

### Semantica visual de Messages
En la bitacora, el color principal representa direccion: entrante verde y saliente amarillo. Si un saliente falla, conserva el amarillo pero muestra un indicador de error por estado.

### Estructura de Messages
La seccion `Messages` se organiza como lista de conversaciones mas vista de hilo. Cada conversacion corresponde a una pagina y un contacto.
Las conversaciones se ordenan por `lastMessageAt desc` y, al entrar a `Messages`, se abre automaticamente la conversacion mas reciente.
Cuando un tenant tiene multiples paginas conectadas, `Messages` muestra por defecto conversaciones de todas las paginas con un filtro visible por pagina.
Mientras no exista resolucion de nombre real del contacto, la UI identifica al contacto por su `contactId` o PSID en formato amigable.

### Pantallas de configuracion
La gestion de paginas conectadas no vive dentro de `Settings` en el MVP; se realiza en una pantalla separada.
La pantalla separada se llama `Connections` y vive en la ruta `/connections`.
`Settings` queda limitado a cuenta y API keys en el MVP.

### Gestion de paginas en Connections
`Connections` es la pantalla operativa de Meta. Cada pagina conectada puede mostrar y editar su `webhookUrl`, ademas de desconectarse.
La `webhookUrl` se guarda con accion explicita mediante boton `Guardar`.
Desconectar una pagina requiere confirmacion explicita y debe advertir que se conserva el historial.

### Gestion de API keys en Settings
Cada API key tiene `label` y su valor secreto se muestra una sola vez al momento de crearla; despues solo queda visible su metadata no secreta.
La lista de API keys muestra `label`, prefijo visible corto, `createdAt`, `lastUsedAt` y estado.
Una API key revocada sigue visible en la lista con estado `revoked`; deja de autenticar, pero no desaparece del historial operativo.
Cada API key del MVP autentica acceso a todas las paginas del tenant; no existen restricciones por pagina en esta version.

### Identidad legal
La entidad que opera Resender es **AI Beat**. `Resender` es el nombre del producto; `AI Beat` es la empresa responsable que figura en los documentos legales (politica de privacidad, terminos).

### Responsable y Encargado (roles de privacidad)
Resender trata dos clases de datos con roles distintos. Para los datos de la cuenta/`tenant` (los clientes de Resender), **AI Beat es el responsable**. Para los mensajes de usuarios de Messenger que escriben a las paginas de los tenants, **AI Beat actua como encargado/procesador en nombre del tenant**, que es el responsable de esas conversaciones. Este reparto determina que las obligaciones de cara al end-user recaen sobre el tenant, no sobre AI Beat.

### Postura de cumplimiento
La politica de privacidad adopta una linea base pragmatica para clientes de USA y Latinoamerica: lenguaje claro, derechos genericos del titular (acceso, correccion, eliminacion, opt-out) sin comprometerse con un regimen especifico (GDPR/LGPD). Queda "GDPR-ready" para anadir secciones si en el futuro entran clientes europeos.

### Contacto legal y de seguridad
El correo publico unico para privacidad, solicitudes de eliminacion de datos y reporte de vulnerabilidades es `info@resender.dev`. Debe ser un buzon real y monitoreado.

### Metodo de eliminacion de datos
Resender NO usa el Data Deletion Callback de Meta (el `signed_request` trae un FB `user_id` que no mapea a nada: el OAuth nunca guarda el FB user_id del que conecta). En su lugar, el campo "Data Deletion" del panel apunta a una **Data Deletion Instructions URL**: una pagina publica `/data-deletion` que explica como borrar los datos. El borrado real ocurre por dos canales: el boton self-serve en `Settings` y el correo `info@resender.dev` (≤30 dias).

### Borrado de cuenta (account deletion)
"Delete account" en `Settings` borra **todo** el tenant (cuenta, paginas, conversaciones, mensajes, API keys); no hay borrado parcial en el MVP. Es inmediato y transaccional en produccion; los backups se purgan en ≤30 dias. Antes de borrar, se intenta best-effort dar de baja cada pagina activa del webhook de Meta. Requiere confirmacion destructiva (reescribir el email de la cuenta). Se implementa con FKs `on delete cascade` (migracion `0002`), que reemplazan el `on delete restrict` original. Cuidado: con cascade, borrar una fila de `connected_pages` arrastraria su historial; hoy nada borra paginas (ver [Desconexión de páginas], que es UPDATE no DELETE).
