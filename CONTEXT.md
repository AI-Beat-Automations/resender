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

### Waitlist
El registro esta abierto, pero el acceso al producto esta cerrado por una bandera `users.waitlisted`. Una cuenta nueva nace con `waitlisted = true` y aterriza en la pantalla `/waitlist`, que le indica que le avisaremos por email cuando su acceso este listo. Solo con `waitlisted = false` el usuario entra a `Connections`, `Messages` y `Settings`.
La bandera se lee de base de datos en cada request (no vive en el JWT), asi que sacar a alguien de la waitlist surte efecto sin pedirle volver a iniciar sesion. El criterio es fail-closed: si no se puede confirmar la bandera, no hay acceso.
Las cuentas que ya existian cuando se introdujo la waitlist quedan con `waitlisted = false`, para no bloquear la cuenta de revision de Meta. Aprobar a un usuario es hoy una operacion manual por SQL; no hay panel de administracion en esta version.
La waitlist tambien cierra las puertas fuera de la UI: el OAuth de Meta (`/api/meta/start` y `/api/meta/callback`) redirige a `/waitlist` y la API externa de salida responde `403` si el tenant esta en waitlist.

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
El registro MVP valida email y exige solo password con longitud minima de 8 caracteres; el cambio de password usa la misma politica minima.
El MVP no incluye recuperacion de password.
El usuario autenticado puede cambiar su password desde `Settings` definiendo un password nuevo; esto no exige conocer el password anterior y no equivale a recuperacion de password. Tras cambiarlo, Resender cierra la sesion actual, lo envia a `login` y le indica que debe iniciar sesion con el password nuevo.
En `login`, los errores son genericos. En `register`, el email duplicado se informa de forma explicita.

### Ownership de páginas
Una página de Facebook conectada pertenece a un solo tenant y no hay transferencia automática de ownership.
El ownership se evalúa **página por página**, no sobre la lista completa que devuelve Meta. Que una página ya esté tomada por otro tenant no invalida las demás: si Arturo conectó A y B, y Felipe —que también las administra— quiere conectar C y D, Felipe puede hacerlo. A y B le aparecen en la lista deshabilitadas, con un cartel de que ya están conectadas en otra cuenta. Se muestran en vez de ocultarse para que el usuario entienda por qué le falta una página que sí administra. Decisión en `docs/adr/0004-page-selection-and-per-page-ownership.md`.

### Páginas conectadas por tenant
Cada tenant puede conectar múltiples páginas de Facebook, hasta el límite de su plan (ver [Límites por plan]). El límite cuenta solo las páginas `active`: las desconectadas no ocupan cupo, pero reconectar una estando en el tope se bloquea igual que conectar una nueva.
Resender ya no conecta automáticamente todas las páginas que Meta devuelve. Ver [Selección de páginas].
La conexión sigue siendo all-or-nothing **sobre el subconjunto seleccionado**: antes de persistir, Resender verifica que el servidor pueda cifrar tokens y que las páginas sean conectables por ownership local, y exige que Meta confirme la suscripción al webhook de cada página elegida. Si alguna suscripción falla, no se guarda ninguna.

### Selección de páginas
Entre el callback de Meta y la conexión hay una pantalla donde el usuario elige qué páginas conectar, dentro del límite de su plan.
La pantalla **solo agrega**: desmarcar una página ya conectada no la desconecta. Desconectar sigue siendo una acción explícita con confirmación en `Connections` (ver [Gestion de paginas en Connections]), para que el flujo de reconexión no pueda desconectar páginas por accidente.
Para que los page access tokens de las páginas descartadas nunca lleguen a la base, Resender persiste cifrado el **user access token de larga duración** que ya obtiene en el intercambio de OAuth. La pantalla muestra solo `id` y `name`; al confirmar, Resender vuelve a llamar `/me/accounts` con ese token y guarda únicamente los page tokens de las páginas elegidas. Efecto colateral útil: agregar una página más adelante no exige repetir el OAuth de Meta.

### Reconexión de páginas
Si una página ya conectada pertenece al mismo tenant y se vuelve a autorizar en Meta, la reconexión es idempotente: actualiza token, nombre y `updatedAt`.

### Desconexión de páginas
Desconectar una página elimina o desactiva la conexión para futuros envíos y recepciones, pero conserva el historial de conversaciones y mensajes como bitácora.

### Entrega de entrantes al sistema externo
El MVP usa `push`: tras persistir un mensaje entrante, Resender lo reenvía de forma no bloqueante al sistema externo del tenant.
La URL de destino externo se configura por página. Si una página no tiene `webhookUrl`, el mensaje entrante se persiste igual y aparece en la bitácora, pero no se reenvía.
La `webhookUrl` debe usar HTTPS para destinos reales; HTTP queda reservado a desarrollo local.
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

### Cuenta de revision
Para Meta App Review, Resender usa una cuenta de revision preconfigurada en lugar de pedirle al revisor que haga onboarding desde cero. Esta cuenta representa un tenant de Resender y debe tener una pagina de Facebook de prueba ya conectada, una `webhookUrl` configurada y una automatizacion demo activa que responda por la API externa de salida. Las credenciales compartidas con Meta son solo de Resender; no se comparten credenciales personales de Meta/Facebook.

### Page de revision
La Page de revision es la pagina de Facebook conectada dentro de la cuenta de revision. Los mensajes no llegan al usuario de Resender directamente: llegan a esta Page, Resender los persiste en la bitacora y los reenvia al sistema externo configurado. El revisor debe poder enviar un DM a esta Page y ver en Resender que aparece la conversacion, junto con la respuesta enviada de vuelta por Messenger.

### Usuario Messenger de prueba
El Usuario Messenger de prueba es una cuenta de Facebook controlada por AI Beat/Resender que se usa para grabar el screencast y enviar DMs a la Page de revision mientras la app esta en modo Development o pendiente de aprobacion. Esta cuenta debe tener el rol/relacion necesaria en Meta para que sus mensajes lleguen al webhook antes de que `pages_messaging` este aprobado en Live. No se comparten credenciales personales de Facebook/Messenger con Meta; al revisor se le entrega la cuenta de revision de Resender y pasos claros.

### Automatizacion demo
La automatizacion demo es el sistema externo conectado al `webhookUrl` de la Page de revision. Su objetivo no es cambiar el modelo de producto ni convertir Resender en bot, sino demostrar durante App Review que el flujo completo de `pages_messaging` funciona: DM entrante, persistencia, push externo, respuesta por `/api/meta/send` y recepcion del mensaje en Messenger.

### Identidad legal
La entidad que opera Resender es **AI Beat**. `Resender` es el nombre del producto; `AI Beat` es la empresa responsable que figura en los documentos legales (politica de privacidad, terminos).

### Responsable y Encargado (roles de privacidad)
Resender trata dos clases de datos con roles distintos. Para los datos de la cuenta/`tenant` (los clientes de Resender), **AI Beat es el responsable**. Para los mensajes de usuarios de Messenger que escriben a las paginas de los tenants, **AI Beat actua como encargado/procesador en nombre del tenant**, que es el responsable de esas conversaciones. Este reparto determina que las obligaciones de cara al end-user recaen sobre el tenant, no sobre AI Beat.

### Postura de cumplimiento
La politica de privacidad adopta una linea base pragmatica para clientes de USA y Latinoamerica: lenguaje claro, derechos genericos del titular (acceso, correccion, eliminacion, opt-out) sin comprometerse con un regimen especifico (GDPR/LGPD). Queda "GDPR-ready" para anadir secciones si en el futuro entran clientes europeos.

### Contacto legal y de seguridad
El correo publico unico para privacidad, solicitudes de eliminacion de datos y reporte de vulnerabilidades es `info@resender.dev`. Debe ser un buzon real y monitoreado.

### Terminos de servicio
La pagina publica `/terms` contiene los Terminos de Servicio de Resender para tenants. Debe dejar claro que el tenant es responsable de sus Pages, automatizaciones externas, contenido de mensajes, cumplimiento de politicas de Meta, consentimiento de usuarios y uso aceptable. Esta pagina complementa `/privacy` y `/data-deletion` como artefacto legal para App Review.

### Metodo de eliminacion de datos
Resender NO usa el Data Deletion Callback de Meta (el `signed_request` trae un FB `user_id` que no mapea a nada: el OAuth nunca guarda el FB user_id del que conecta). En su lugar, el campo "Data Deletion" del panel apunta a una **Data Deletion Instructions URL**: una pagina publica `/data-deletion` que explica como borrar los datos. El borrado real ocurre por dos canales: el boton self-serve en `Settings` y el correo `info@resender.dev` (≤30 dias).

### Configuracion de revision Meta
Para el envio actual a Meta App Review, Resender solicita solo permisos de Messenger: `pages_messaging`, `pages_manage_metadata` y `pages_show_list`. No se solicitan permisos de Instagram, WhatsApp, Business Management ni otros permisos extra en esta revision.
Los permisos viven en el `config_id` de Facebook Login for Business, no en codigo. El `config_id` usado para esta revision es nuevo y dedicado a este envio de Messenger; quedo configurado solo con `pages_manage_metadata`, `pages_messaging` y `pages_show_list`. En particular, `business_management` queda fuera del alcance de Messenger porque Resender no administra Business Manager, WABAs, cuentas publicitarias ni assets de negocio en este flujo. El panel de Meta debe mantenerse alineado con el alcance real del producto: listar paginas autorizadas, suscribir/desuscribir paginas al webhook y enviar/responder mensajes de Messenger.
El dominio canonico para el envio es `resender.dev`. Las URLs publicas que deben cargarse en Meta Dashboard son `https://resender.dev/privacy` como Privacy Policy URL y `https://resender.dev/data-deletion` como Data Deletion Instructions URL.

### Documentacion publica del flujo (`/docs`)
La pagina publica `/docs` documenta, en ingles y para developers externos, el flujo de integracion en 3 pasos. Vocabulario canonico en ingles (alineado con el modelo existente):
- **Channel** = pagina de Facebook conectada (ver [Gestion de paginas en Connections]).
- **Inbound message** = mensaje del cliente que Resender hace push al `webhookUrl` del developer (ver [Entrega de entrantes al sistema externo]). Tiene `direction: "inbound"`, `status: "received"`. NO se llama "response"/"respuesta".
- **Reply** = respuesta del developer al cliente via `POST /api/meta/send` (ver [API externa de salida]).
Resuelto: en el spec original "respuesta" apuntaba al mensaje que llega al webhook; eso es un **inbound message**, no una response. La unica "response" es el **reply** que sale por el endpoint.
Gotcha documentado: el campo `pageId` de `POST /api/meta/send` se matchea contra `meta_page_id`, asi que el developer debe pasar el `page.metaPageId` del payload entrante (no el `page.id` interno). `recipientId` = el `conversation.contactId` del payload entrante.

### Borrado de cuenta (account deletion)
"Delete account" en `Settings` borra **todo** el tenant (cuenta, paginas, conversaciones, mensajes, API keys); no hay borrado parcial en el MVP. Es inmediato y transaccional en produccion; los backups se purgan en ≤30 dias. Antes de borrar, se intenta best-effort dar de baja cada pagina activa del webhook de Meta. Requiere confirmacion destructiva (reescribir el email de la cuenta). Se implementa con FKs `on delete cascade` (migracion `0002`), que reemplazan el `on delete restrict` original. Cuidado: con cascade, borrar una fila de `connected_pages` arrastraria su historial; hoy nada borra paginas (ver [Desconexión de páginas], que es UPDATE no DELETE).

### Suscripcion (billing)
El uso del producto requiere una suscripcion de pago gestionada por Stripe. Hay 2 planes mensuales en USD: **Starter $15** y **Pro $25**. Solo ciclo mensual.
El plan **Business $60** fue eliminado: su price esta archivado en Stripe y nunca tuvo suscripciones. El ADR 0002 y las versiones anteriores de esta seccion hablaban de 3 planes; quedan enmendados.
La diferenciacion funcional entre planes ya no es binaria: cada plan trae una cuota de mensajes y un limite de paginas. Ver [Límites por plan]. Decisiones en `docs/adr/0002-stripe-checkout-subscriptions.md` y `docs/adr/0003-plan-entitlements-usage-quota.md`.

### Límites por plan
| Plan | Precio | Mensajes por período | Páginas |
|---|---|---|---|
| `starter_monthly` | $15 | 50.000 | 2 |
| `pro_monthly` | $25 | 100.000 | 5 |

El límite se resuelve desde `subscriptions.price_lookup_key` contra un mapa en código. Un `price_lookup_key` desconocido es fail-closed, igual que el resto de los gates.

### Mensaje contabilizado
La cuota mide **ambas direcciones**: cada [Inbound message] persistido suma 1, y cada reply que Meta acepta (`status: 'sent'`) suma 1. Una conversación de ida y vuelta consume 2 unidades, así que los 50.000 del Starter son ~25.000 intercambios; los números publicados se mantienen sabiendo esto.
**No** consumen cuota: un envío que Meta rechaza (`status: 'failed'`) —el cliente no paga por un page token vencido nuestro ni por la ventana de 24h de Messenger— ni un replay idempotente, que no llama a Meta ni inserta mensaje nuevo.
Los entrantes **cuentan aunque no se entreguen**: si el tenant está restringido o la página no tiene `webhookUrl`, el mensaje se persiste igual y consume cuota. Lo que la cuota cubre es recibir y persistir, no entregar.

### Período de cuota
La ventana es el **período de facturación de Stripe**, no el mes calendario: el contador se resetea cuando cierra el ciclo que el cliente pagó, para no regalar una cuota completa a quien paga el día 28. Requiere `subscriptions.current_period_start`, que la migración `0005` no incluía. Sin período conocido no hay envío (fail-closed).
El límite es un **tope práctico, no exacto**: como solo cuentan los envíos que Meta acepta, hay que llamar a Meta y después incrementar, y sin transacciones interactivas en el driver HTTP de Neon un puñado de requests concurrentes puede pasarse por decenas de mensajes.

### Cambio de plan
El **upgrade se aplica inmediato**: sube el techo y **conserva el consumo** del período (quien gastó 50.000 y sube a Pro tiene 50.000 restantes, no 100.000). Así ciclar planes no sirve para resetear cuota, y un cliente bloqueado puede desbloquearse pagando en el acto.
El **downgrade se difiere** al cierre del período: quien pagó el mes lo usa completo, mismo criterio que `cancel_at_period_end`. El Customer Portal de Stripe debe configurarse para diferirlo; por defecto Stripe lo aplica inmediato con prorrateo.

### Cuenta restringida
Estado degradado con dos causas: **cuota agotada** o **exceso de páginas** tras un downgrade (bajar a Starter con 5 páginas conectadas).
En ambos casos el comportamiento es el mismo: los entrantes se siguen persistiendo en la bitácora, dejan de reenviarse al webhook del cliente, y el envío queda bloqueado **para todas las páginas** del tenant, no solo las excedentes. No desconectamos páginas nosotros: desconectar es siempre acción del usuario.
Se levanta al resolverse la causa: nuevo período de facturación, o el usuario desconecta páginas hasta quedar dentro de su límite.
Se distingue del [Gate de suscripcion], que sí descarta los entrantes sin persistir.

### Errores de límite en la API
Dos códigos distintos, porque la acción del cliente es distinta:
- `402 Payment Required` + `quota_exceeded` — se arregla subiendo de plan.
- `403 Forbidden` + `page_limit_exceeded` — se arregla desconectando páginas.
- `403 Forbidden` + `plan_unavailable` — fail-closed cuando no se puede resolver el plan (`price_lookup_key` desconocido) o el [Período de cuota]. No es una causa de negocio sino una inconsistencia de datos: se arregla del lado de Resender, y el `message` manda a soporte.

Cada uno con `message` legible. Se suman al contrato de errores `snake_case` de `prd_api_separation.md`. Se descartó `429`, que comunica velocidad y no cuota comprada.

### Aviso de cuota
A partir del **80%** del consumo del período aparece una barra de alerta **global en el dashboard**, no solo en `Connections`: quien no entra a esa pantalla no se entera.
No hay email transaccional en esta entrega (no existe canal de correo en el repo). Pendiente: la FAQ pública promete "Te avisamos cuando te acercás al límite" dos veces en `content/i18n/es.ts`, que un cliente lee como email; hay que reescribirla para que apunte al dashboard.

### Gate de suscripcion
Segundo gate en serie despues de la [Waitlist]: la waitlist decide quien puede entrar, la suscripcion decide quien puede usar. Un usuario con `waitlisted = false` pero sin suscripcion activa aterriza en la pagina de pricing. El acceso existe solo con status `active` en la tabla `subscriptions`; cualquier otro estado es **bloqueo total**: dashboard, OAuth de Meta y `POST /api/meta/send` (403) quedan cerrados, y los webhooks entrantes de Meta del tenant se descartan sin persistir (respondiendo `200` a Meta para no degradar la app). Mismo patron que la waitlist: se lee de base de datos en cada request, fail-closed, nunca del JWT ni de la API de Stripe en el hot path.

### Sin trial
No hay periodo de prueba: para usar el producto hay que pagar. El primer cobro ocurre dentro del propio Stripe Checkout y no existe logica de trial en ninguna capa (ni `trial_period_days` en Checkout ni flags propios en base de datos).

### Stripe Checkout y Customer Portal
Resender no maneja datos de tarjeta: la compra se hace en la pagina de Checkout hosteada por Stripe (redirect) y toda la gestion posterior (cambiar plan, actualizar tarjeta, cancelar) ocurre en el Customer Portal de Stripe, enlazado desde `Settings`. La cancelacion es `cancel_at_period_end`: quien pago el mes lo usa completo. El servidor solo crea sesiones de Checkout/Portal via API con la secret key.

### Webhook de Stripe
El estado de las suscripciones se replica en Postgres consumiendo webhooks firmados de Stripe en `app/api/stripe/webhook` (verificacion con `STRIPE_WEBHOOK_SECRET`, espejo del patron HMAC del webhook de Meta). Eventos relevantes: `checkout.session.completed` y `customer.subscription.created/updated/deleted`, procesados con upsert idempotente sobre la tabla `subscriptions`. En desarrollo se usa `stripe listen` (Stripe CLI) para recibirlos en local.
