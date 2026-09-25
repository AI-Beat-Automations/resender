# Context

## Canonical Terms

### Better Auth

La autenticación web de Resender en Next.js se implementa con `Better Auth`, que es la unica autoridad de [Sesion] y de [Credencial] de la aplicacion. Reemplazo a Auth.js: decisiones y alternativas descartadas en `docs/adr/0014-better-auth-reemplaza-authjs.md`.
El MVP expone páginas separadas de autenticación: `/login`, `/register`, `/forgot-password` y `/reset-password`. Las dos últimas son la [Recuperacion de password]. `/login` y `/register` ofrecen tambien "Continuar con Google" ([Cuenta vinculada]); el flujo social entero sigue siendo server actions, como todo lo demas: el repositorio no tiene `authClient` y hay que sostenerlo asi.
Tras `login` o `register` la sesion queda abierta y el destino lo decide el [Gate de acceso], no la autenticacion: una cuenta aprobada aterriza en `/connections` para continuar el onboarding conectando Facebook, y una cuenta bloqueada aterriza en `/pending`. Desde la `0024` ninguna cuenta nace bloqueada, asi que ese destino solo aparece si alguien vuelve a poner `waitlisted = true` a mano.
Las rutas protegidas redirigen a `/login` cuando el usuario no esta autenticado.
Si un usuario autenticado entra a `/login` o `/register`, se redirige a `/connections`, pero **solo si su cuenta puede entrar al producto**: una sesion que el gate rechazaria se queda viendo el formulario, para que las dos rutas no se reboten entre si para siempre.
Los intentos de acceso y de alta tienen limite por IP: diez por minuto, contados por el binding nativo de Cloudflare. Se aplica en los server actions y tambien en `POST /api/auth/*`, que queda publicamente expuesto y se puede martillar salteandose los actions. Ese limite cubre el reenvio de la [Verificacion de correo] y **no** cubre el `GET /api/auth/callback/google`, que queda fuera a sabiendas —deuda declarada en el issue #98—: martillarlo sin un `state` valido no produce trabajo caro ni escrituras.

### Sesion

La sesion vive en la tabla `auth_sessions` y **esa fila es la fuente de verdad**. La cookie que lleva el navegador es un cache cifrado (JWE) con cinco minutos de vida, y es lo que resuelve la mayoria de los requests sin tocar la base.
Dura siete dias de inactividad y se extiende sola cada veinticuatro horas de uso: quien entra seguido no se desloguea nunca.
Borrar la fila deja fuera a esa sesion en cuanto vence el cache, como mucho cinco minutos. Es lo que el JWT de Auth.js no permitia: antes una cookie filtrada valia hasta su vencimiento y la unica salida era cambiar el secreto para todos.
**Ninguna bandera de acceso viaja en la sesion ni en su cache** — ver [Gate de acceso].

### Credencial

Lo que prueba que alguien es quien dice: una fila de `auth_accounts`. Existen dos proveedores: `credential`, que guarda el hash de la contraseña, y `google`. Cada proveedor suma su propia fila para el mismo usuario: las credenciales se acumulan y ninguna reemplaza a otra ([Cuenta vinculada]).
**No confundir con [Cuenta conectada]**, que es otra cosa entera: una pagina de Facebook, una cuenta de Instagram o un numero de WhatsApp del cliente.
La credencial de una maquina, en cambio, es el [API Token]: la misma idea —probar quien sos— para la integracion externa, que no reutiliza la sesion web.

### Cuenta vinculada

Una cuenta de Resender puede entrar por password, por Google, o por las dos. Cada via es una [Credencial] propia y **las credenciales se acumulan: vincular Google nunca borra la password**, y quien tenia las dos sigue entrando con cualquiera.
Vincular ocurre solo si los correos coinciden y **la cuenta local ya confirmo el suyo**; si no, no se vincula y se ofrece confirmarlo. Desde `/login` y `/register` esa regla la aplica [Better Auth] con sus defaults, no codigo propio; desde `Settings` la aplica la accion de vincular, porque en ese camino la libreria solo exige que los correos coincidan.
Cuando Google se suma a una cuenta que **ya tenia** password, sale un aviso al buzon. Es la contrapartida de no borrar nada: no se le quita a nadie una forma de entrar, pero el dueño del correo se entera de que aparecio otra.
Se ven y se administran en `Settings`, en el panel "Como entras a Resender". Arriba de las credenciales, ese panel muestra el estado del correo: si no esta confirmado dice "Correo sin confirmar" y ofrece reenviar la [Verificacion de correo], y el boton "Vincular" de Google queda deshabilitado —con el motivo al lado— mientras el correo no este confirmado. `Settings` es ademas donde una cuenta aprobada confirma su correo, porque `/pending` la rebota a `/connections` antes de mostrarle nada. No se puede quitar la ultima: una cuenta sin ninguna credencial no podria volver a entrar.
**No confundir con [Cuenta conectada]**, que es una pagina de Facebook, una cuenta de Instagram o un numero de WhatsApp del cliente.

### Landing

La ruta `/` sigue siendo una landing pública simple con la propuesta de valor y accesos a `Login` y `Register`.

### Registro MVP

En el MVP, el registro pide nombre, email y password, crea la cuenta, abre sesion inmediatamente y manda un correo de [Verificacion de correo]. Hay una segunda via de alta, "Continuar con Google", que no pide password ni manda ese correo: la cuenta nace con el correo confirmado ([Cuenta vinculada]). En ninguna de las dos se exige verificación de email antes de usar la app. Entrar al producto es otra cosa: eso lo decide el [Gate de acceso], que hoy esta apagado.

### Gate de acceso

El registro esta abierto y el acceso al producto tambien: la bandera `users.waitlisted` nace en `false` desde la `0024`. El gate sigue cableado y se puede cerrar una cuenta a mano con `update users set waitlisted = true where email = '...'`. Se lee viva contra la base en cada request —**nunca de la [Sesion] ni de su cache**—, es fail-closed y se aplica en el layout de `(product)`, en `/billing` y en los `start`, `callback` y `send` de los tres canales. Meterla en la sesion la meteria en el cache de cinco minutos: aprobar o revocar una cuenta dejaria de pegar en la siguiente request.
El gate nacio con la `0004`, se apago con la `0011` (ADR 0007, para que el CTA de registro de la [Lista de espera] publica no fuera mentira), volvio a encenderse con la `0019_reenable_access_gate.sql` (`default true`, sin tocar a los existentes) y **se apago otra vez con la `0024_open_access_and_instagram.sql`**: `default false` y todas las cuentas existentes a `false`. Cualquiera que inicie sesion conecta sus canales sin aprobacion.
Una cuenta bloqueada a mano queda con sesion abierta y aterriza en `/pending`, la pantalla autenticada del gate: confirma que el registro salio bien, muestra a que correo se le va a escribir y ofrece cerrar sesion. **No** es `/waitlist`: esa ruta es la [Lista de espera] publica y pide un correo que esta persona ya dio.
Aprobar una cuenta pega en la siguiente request, sin re-login. Despues del gate de acceso todavia falta el [Gate de correo del Free].
Decisiones en `docs/adr/0007-public-waitlist-and-access-gate-shutdown.md` (el primer apagado); ni la reactivacion de la `0019` ni el apagado de la `0024` tienen ADR propia.
No confundir con el [Permiso de Instagram]: este gate es del producto entero; el permiso de Instagram es por canal y se opera igual —por SQL, sin pantalla—.

### Lista de espera

Lista publica de captacion, sin relacion con el gate anterior. Su unico proposito es guardar el correo de alguien que hoy no puede comprar —porque solo existe Messenger— para avisarle cuando salgan Instagram o WhatsApp. Esta pensada para repartir en conferencias y contactos cara a cara, ademas de la landing.
**No** es una lista de interes por canal: la persona no elige que espera. Deja el correo y recibe los anuncios de producto; el copy promete "updates", no un canal concreto.
Vive en la tabla propia `waitlist_signups` (Postgres, no un proveedor externo), con `unique index` sobre `lower(email)`. La salida es el script `npm run waitlist:export` (CSV): no hay panel de administracion. El [Canal de correo] ya existe, pero **solo manda correos transaccionales de cuenta** y no hay envio masivo ni enlace de baja, asi que la lista se sigue acumulando sin poder accionarse.
Un correo repetido es un **exito idempotente**: no se inserta nada, la persona ve el mismo mensaje que la primera vez y la atribucion del primer registro queda intacta (first-touch). No se revela si un correo esta en la lista.

### Campos de la lista de espera

El formulario pide dos cosas, y las dos son obligatorias:

- `email`.
- `heard_from`: como conocio Resender. Seleccion **unica** entre `tiktok`, `instagram`, `x`, `youtube`, `linkedin`, `event` y `other`; con `other`, el texto libre `heard_from_other` tambien es obligatorio (~120 caracteres). Se guardan **claves, nunca etiquetas traducidas**: el label rompe el `group by` en un sitio bilingue.

`source` lo escribe el servidor, no el usuario: vale `landing` o `waitlist_page` y registra **la ruta** donde se completo el formulario. No se lee ningun `?ref=`, asi que se distingue landing de pagina pero nunca un evento de otro. `heard_from = 'event'` dice que vino de un evento presencial, jamas de cual.

### Consentimiento de la lista de espera

El checkbox de consentimiento es **bloqueante**: sin marcarlo no se envia, porque una fila sin consentimiento seria una fila a la que no se le puede escribir. Se persisten `consent_at` y `consent_version` para saber que texto acepto cada persona cuando la redaccion cambie.
La columna `unsubscribed_at` existe desde el inicio: se promete baja, y el aviso que se mande el dia del lanzamiento va a necesitar un enlace real. El [Canal de correo] existe, pero ese enlace de baja todavia no se construyo.
`/privacy` suma un bloque **Waitlist data**. Las dos categorias que declaraba —_Account data_ y _Messenger end-user data_— no cubren el correo de alguien que no es cliente guardado para mandarle un anuncio.

### Donde aparece la lista de espera

- **Landing (`/` y `/en`)**: el formulario no es una seccion propia debajo de los precios. Se fusiona en el cierre existente (`FinalCta`), con `Empieza` como accion primaria y el formulario como camino secundario, para no poner la salida gratis entre el precio y el CTA de conversion.
- **`/waitlist` y `/en/waitlist`**: pagina publica con explicacion breve de que es Resender, el formulario, y un CTA de registro para quien ya le sirve Messenger hoy. Es el enlace que se reparte en conferencias.
- Ambas leen su copy del diccionario, incluidas las siete etiquetas de `heard_from` y el texto de consentimiento. `/waitlist` sale de `PRIVATE_PATHS` en `app/robots.ts` y entra al sitemap.

### Proteccion del formulario publico

Es la primera escritura anonima a base de datos del repo: todo lo demas exige sesion, API key opaca o firma HMAC. Tres capas: validacion de formato de correo, campo trampa (honeypot) oculto, y rate limit por IP con el binding nativo `ratelimits` de Cloudflare en el worker de `web`. Cloudflare Turnstile queda descartado por ahora —suma un paso que puede fallarle a un usuario real justo cuando esta delante en un evento— y se agrega si aparece basura real.

### API Token

La integración externa (N8N/IA) **no reutiliza la sesión web**. Se autentica con una API key opaca separada, emitida por Resender para el tenant.
Es la otra forma de la misma idea que la [Credencial]: las dos prueban quién sos, pero la [Credencial] es de una persona delante de un formulario y la API key es de una máquina llamando a la API. Desde la ADR 0014 las dos las emite y verifica [Better Auth]: la sesión con su núcleo, las API keys con el plugin `apiKey`.
El formato visible es `pk_live_<secreto>`: un prefijo legible más 64 caracteres aleatorios. En base de datos —tabla `auth_api_keys`— solo vive el hash SHA-256 del secreto, nunca la credencial completa, y junto a él los primeros 16 caracteres (`pk_live_` + 8) como prefijo visible.
Para la API externa no se usan JWTs; la única credencial aceptada es una API key opaca tipo `Bearer pk_live_<secreto>`.

### API Tokens en Settings

Las API keys opacas se crean y gestionan desde `Settings`. Puede haber múltiples keys por tenant y cada una tiene un `label` descriptivo elegido por el usuario, de hasta 80 caracteres.
Las keys viven hasta revocación manual: **no expiran solas** y no tienen cupo de usos. Tampoco distinguen permisos ni tienen límite de tasa propio; el plugin ofrece las tres cosas y las tres están apagadas a propósito (`lib/auth/auth.ts`).
La emisión, el hashing y la verificación las hace el plugin `apiKey` de [Better Auth], no una implementación propia. Es la razón por la que `AUTH_SECRET` dejó de tener consumidores y se pudo borrar: el plugin hashea con SHA-256 sin pepper.
Revocar es apagar la key, no borrarla: la fila queda con su estado y deja de autenticar en la verificación siguiente.

### Tenant

En el MVP, `tenantId = userId` de nuestra autenticación, con una sola ampliación desde el módulo Clientes: **un [Cliente] hereda el `tenantId` del [Padre]**. Sus conexiones, conversaciones, mensajes, contadores y cuota se guardan y se filtran con el `tenant_id` del padre; lo que distingue lo del cliente es `connected_pages.client_account_id`, no otro tenant. La regla sigue siendo «toda consulta filtra por un solo tenant id»: quién es el actor y de qué tenant es lo que ve lo decide el [Actor] en cada request.

### Actor

Quién está detrás de la [Sesion] y a qué tenant pertenece lo que ve: `{ tenantId, userId, clientAccountId | null }` (`lib/clients/actor.ts`, `resolveActor(session)`; en las pantallas se lee por `resolveActorCached`, una sola vez por request). Para el [Padre] `tenantId === userId` y `clientAccountId` es nulo: nada cambia para él. Para un [Cliente] activo, `tenantId` es el del padre y `clientAccountId` es lo que distingue lo suyo. Se lee **vivo contra la base en cada request y nunca de la sesión**, con la misma doctrina que el [Gate de acceso]: fail-closed, sin fila no hay actor. El layout de `(product)` lo resuelve primero (sesión → actor → gates → render) y todo lo que se oculta o filtra por rol —sidebar, pestañas de Ajustes, aviso de cuota, Conexiones e Inbox— se decide a partir de él con funciones puras por actor (`productNavItems`, `settingsTabsFor`, `resolveClientFilter`). Las server actions lo piden con `resolveActionActor` (`lib/clients/action-actor.ts`), compartido por Conexiones e Inbox. Un user con fila de cliente todavía `pending` no tiene actor: ve la [Cuenta restringida] sin padre nombrado.

### Padre

El tenant dueño del plan: quien paga, quien ve todas las conexiones y todo el inbox, y quien puede crear [Cliente]s si su plan es `pro_monthly` o `business_monthly`. Starter y Free ven `/clientes` con un aviso, sin CTA de compra nuevo. No es una entidad propia: es el [Usuario MVP] de siempre visto desde el módulo Clientes.

### Filtro por cliente

Cómo el [Padre] mira Conexiones e Inbox desde que tiene [Cliente]s: las conexiones y conversaciones de sus clientes aparecen junto a las suyas, cada una con una **etiqueta con el nombre del cliente** (en la tarjeta, en la fila de la lista y en la cabecera del hilo), y un desplegable «Filtrar por cliente» con «Todos los clientes», «Mis conexiones» y un cliente por fila. El filtro vive en `?cliente=` (`lib/clients/client-filter.ts`: `resolveClientFilter` valida el valor contra los clientes del tenant y descarta en silencio lo que no reconoce; `propias` son las filas sin cliente) y los read models lo aplican **en la consulta**, encima del alcance del [Actor], nunca en memoria ni en el navegador. Es un filtro de vista, distinto del alcance de seguridad: para un actor cliente el parámetro no hace nada. En Inbox se conserva al cambiar de modo, de cuenta y de selección (`inboxHref`); en Conexiones, `connectionsHref`. Solo se monta si el padre tiene al menos un cliente: sin clientes «Todos» y «Mis conexiones» dicen lo mismo. Sobre las conexiones de sus clientes el padre gestiona webhook, pausa y desconexión exactamente como sobre las suyas: su `clientAccountId` nulo ve todo el tenant.

### Logs

La sección `/logs` de la consola: la **bitácora de peticiones** del [Padre], para depurar su integración. Una fila por petición en una de tres direcciones: **Meta → Resender** (`meta_to_resender`: cada evento que llega por el webhook de Meta ya atribuido a una [Cuenta conectada] —mensaje, postback, eco, comentario o acuse de entrega de WhatsApp—), **Resender → bot** (`resender_to_bot`: la [Entrega de entrantes al sistema externo], **una fila por entrega** que se actualiza en cada intento, con los intentos dentro del detalle) y **Bot → Resender** (`bot_to_resender`: cada request a la [API externa de salida], con lo que el bot mandó y lo que se le contestó; el error de Meta se ve porque ya viaja en esa respuesta, nunca se muestran URLs de Graph). Los envíos hechos a mano desde Inbox no pasan por la API y no aparecen.
Cuatro estados: `success`, `failed`, `retrying` y `skipped`. **`skipped` no es un fallo**: el entrante llegó bien y no se reenvió a propósito (sin webhook, [Pausa de reenvío], [Cuenta restringida]) o era un reintento de Meta ya procesado; el motivo va en `skip_reason`. Un acuse `failed` de WhatsApp queda como `failed` con el motivo de Meta.
Vive en `request_logs` (migración 0028), tabla propia y **proyección para leer**: `external_webhook_jobs` sigue siendo la fuente de verdad del motor de entregas. Guarda los cuerpos de request y response como texto recortado a 64 KB, nunca headers ni tokens; de un POST de Meta guarda **solo el fragmento del evento** (`lib/logs/raw-fragments.ts`), porque un mismo POST puede traer eventos de varios tenants. No lleva FK a la conexión, al cliente ni a la conversación —nombre e id externo van denormalizados— para **sobrevivir a una desconexión** hasta cumplir su retención de **30 días**, que barre el cron (`purgeExpiredRequestLogs`). Lo que no se puede atribuir a un tenant (firma inválida, cuenta no conectada, API key inválida) no se guarda.
La escritura (`lib/logs/request-log.ts`) es **best-effort y no lanza nunca**: corre después de responder (`after()`) y un fallo deja una línea `request_log_write` en Workers Logs. Se pierde una fila de pantalla, nunca un mensaje.
Es **solo del padre y de todos los planes**: un [Cliente] no ve el item en el sidebar y por URL vuelve a Conexiones. El padre ve lo suyo y lo de sus clientes, con el [Filtro por cliente] (`?cliente=`) y un filtro por conexión que se acota al cliente elegido. Los filtros viven en la URL (`lib/logs/log-filters.ts`, `logsHref`); cada faceta cuenta con todos los demás filtros puestos menos el propio. La lista pagina con cursor `(created_at, id)` y se refresca por polling cada 5 s mientras la pestaña está visible y no hay detalle abierto. «Ver relacionados» lista las filas del mismo mensaje o del mismo id de Meta, sin límite de período. **No confundir con el log de mensajes de Inbox** (`lib/inbox/log-format.ts`), que es la línea de tiempo de una conversación.

### Cliente

Un espacio que el [Padre] crea desde `/clientes` para un negocio cuyas redes administra: nombre, correo y un **tope de conexiones**. Vive en `client_accounts` (migración 0027) con `user_id` nulo hasta que la persona acepta la invitación; entonces pasa de `pending` a `active`. Un user es cliente de a lo sumo un padre.
El tope es un **máximo, no una reserva**: se valida `1 ≤ tope ≤ maxPages del plan del padre` (ADR 0011: `maxPages` sigue significando «máximo de conexiones») y se acepta uno menor a lo que el cliente ya tiene conectado; la lista pinta `conectadas / tope` en rojo en vez de desconectar nada en nombre del cliente. La regla de cupo al conectar es el [Cupo del cliente].
Crear al cliente manda la [Invitacion de cliente]. Reenviar emite un token nuevo y cancela el anterior; cancelar deja al cliente pendiente sin enlace vivo; **eliminar** muestra las conexiones que se van a desconectar y, al confirmar, da de baja cada una del webhook de Meta como la [Desconexión de páginas], borra el user del cliente si ya aceptó y borra el espacio con sus conexiones, conversaciones y mensajes por cascade. Nada vuelve al padre. Borrar la cuenta del padre elimina primero a sus clientes con ese mismo procedimiento (`lib/clients/client-deletion.ts`).
Un cliente **nunca** ve el módulo Clientes ni nada de facturación. Su **consola reducida**: sidebar con Conexiones, Inbox y Ajustes (sin Clientes ni Documentación); Ajustes solo con la pestaña Cuenta, sin `tenant_id`, sin «Eliminar cuenta» y con la nota «Tu acceso lo administra [padre]»; `api-keys` y `suscripcion` no se dibujan ni se aceptan por URL. El [Aviso de cuota] no se monta para él. Salta la lista de espera y depende de la suscripción del padre: si el padre no tiene suscripción de pago activa (está en el [Plan Free]) ve la [Cuenta restringida] sin CTA de pago y nunca pasa por `/billing` ni `/pending`. Entra por `/login` con correo y contraseña, y puede usar o vincular Google como cualquier user.
En **Conexiones** ve solo las filas con su `client_account_id` (`listTenantPages(tenantId, clientAccountId)`, misma llamada en la página y en el header para que el caché de petición la deduplique) y conecta Messenger, Instagram y WhatsApp **con su propio login de Meta**: el user access token de Messenger se guarda en el user del cliente, no en el del padre, y todo lo demás —cupo, ownership, la fila— es del tenant del padre. Los gates de conectar (`/api/meta/*/start`, los tres callbacks y las server actions) se resuelven por actor en `lib/clients/connect-gate.ts`: el cliente salta la lista de espera, usa la suscripción y el permiso de canal del padre y, cerrado, vuelve a `/connections` y nunca a `/billing`. Su tarjeta de conexión no tiene sección de webhook ni de secreto de firma (`saveWebhookUrlAction` y `rotateWebhookSecretAction` lo rechazan por POST directo); sí tiene el switch de [Pausa de reenvío] y desconectar, y las dos acciones llevan su `clientAccountId` al registro, que no encuentra las filas del padre ni las de otro cliente y responde «no encontramos esa página».
En **Inbox** ve solo las conversaciones y publicaciones de sus conexiones, en los dos modos: los read models (`listConversationReadModel`, `listPublicationReadModel` y las lecturas del hilo) reciben su `clientAccountId` y lo aplican en la consulta sobre `connected_pages.client_account_id`, así que una conversación de otra conexión del tenant no existe para él ni por `?conversation=`. Sigue sin poder responder; sí tiene la [Pausa de reenvío] por conversación, cuya acción lleva el mismo alcance y responde «no encontramos esa conversación» ante un id ajeno. Nunca ve el [Filtro por cliente] ni etiquetas de cliente: todo lo suyo es suyo. **No confundir con [Cuenta conectada]**, que es una página, cuenta o número de Meta: un cliente es la persona a la que se le deja conectar las suyas.

### Cupo del cliente

La regla de cupo al conectar cuando el actor es un [Cliente]: `lib/clients/client-limits.ts`, módulo puro con tests de tabla como `entitlements.ts`. Entradas: `maxPages` del plan del [Padre], conexiones activas de todo el tenant (`countActivePages`, el mismo contador que alimenta el entitlement: la conexión de un cliente ocupa un slot del plan del padre como cualquier otra), tope del cliente y conexiones activas del cliente (`countActiveClientPages`). Salida: `allowed` | `client_limit_reached` | `tenant_limit_reached`, los huecos que de verdad puede usar —el menor entre lo que le queda de su tope y lo que le queda al plan— y el aviso de proximidad. El tope propio se nombra primero: es el límite que el cliente conoce y el que su padre puede mover; el del plan corta aunque al cliente le queden huecos. Un tope menor que lo conectado deja al cliente en el tope, sin negativos. Para el padre (`clientMaxConnections = null`) devuelve el comportamiento de siempre y ningún aviso: el suyo es el [Aviso de cuota]. `client-limits-status.ts` es el lado impuro, como `entitlement-status.ts`.
Se consulta desde los mismos puntos que evalúan el cupo hoy: la selección de páginas de Messenger (`features/connect-meta/selection-view.ts`, compartido por la pantalla y la server action, con `remainingSlots` acotado), el callback de Instagram (con la misma exención de reconexión de una cuenta ya activa) y el cierre de WhatsApp (`checkWhatsappPlanSlot` con `clientAccountId`). Las tres escrituras (`connectAuthorizedPages`, `connectInstagramAccount`, `connectWhatsappNumber`) marcan la fila nueva con el `client_account_id` del actor; en una **reconexión** la marca solo cambia si la fila estaba desconectada —una activa conserva a su dueño aunque otro user del tenant renueve su token—.
**Avisos**: proximidad (queda un hueco o ≥ 80 % del tope), tope propio y límite global del padre son el mismo tipo de aviso: nombran al padre (`getClientOwner`, o «quien administra tu acceso» si no resuelve) y **nunca** mencionan planes ni precios. El padre sigue viendo su aviso de cuota de siempre, con su CTA, y solo él. El rebote del callback de Instagram lleva el veredicto como `reason` (`client_limit_reached` / `tenant_limit_reached`) y Conexiones lo redacta con el nombre del padre; el catálogo de `metaErrors` no lo conoce a propósito porque no tiene el nombre. Textos en `t.clientLimits`.

### Invitacion de cliente

El correo que le llega al [Cliente] cuando el [Padre] lo crea o reenvía. Sale por el [Canal de correo] (plantilla `RESEND_TEMPLATE_CLIENT_INVITATION`, copia en `docs/email/client-invitation.html`) en el idioma resuelto como los demás correos, con el nombre del padre en el asunto, y trae un enlace `/invitacion/<token>` que **vive siete días**. En la base (`client_invitations`) queda solo el hash SHA-256 del token, con el mismo criterio que el [API Token]; el token en claro existe únicamente en el correo. Reenviar crea una fila nueva y cancela la anterior: nunca hay dos enlaces válidos a la vez. Se rechaza crear un cliente con un correo que ya tiene cuenta o una invitación viva, con mensaje explícito.
**Aceptar** (`/invitacion/[token]`, fuera de `(product)` como `/reset-password` porque quien llega no tiene sesión): la página hace un *peek* del token antes del formulario y, si venció, se canceló o ya se usó, lo explica **sin acción** (el padre reenvía). El formulario trae el nombre prellenado con el que puso el padre, el correo fijo y contraseña con confirmación, con las reglas de siempre. `acceptInvitation` consume el token con un update condicional (**un solo uso**, aun con dos aceptaciones simultáneas), crea el user con `email_verified = true` —el enlace probó el buzón, como en la [Recuperacion de password]—, fija la contraseña con el mismo primitivo que Ajustes (`setUserPassword`), enlaza `client_accounts.user_id`, marca `accepted_at` y pasa el estado a `active`. Después el server action abre sesión con el login normal (`signInEmail`) y aterriza en Conexiones; nunca pasa por `/pending`.

### Usuario MVP

El usuario del MVP tiene un modelo mínimo: `id`, `email`, `name`, `email_verified` y `createdAt`, salvo los campos extra estrictamente necesarios para integrar `Better Auth`. **Ya no incluye `passwordHash`**: la contraseña vive hasheada en la [Credencial], no en `users`.
`name` lo pide el alta y es lo que dibuja las iniciales del avatar del sidebar, con el email como respaldo para las filas que lo tengan vacio. No hay pantalla para editarlo. `email_verified` existe porque la libreria lo pide y nadie lo exige para usar la app. Lo ponen en `true` tres cosas: confirmar el correo ([Verificacion de correo]), darse de alta con Google, y completar una [Recuperacion de password], porque el enlace probo que el buzon es suyo. Lo unico que depende de el es vincular Google ([Cuenta vinculada]). `image` lo puebla solo el alta por Google —no la vinculacion— y todavia no se dibuja en ningun lado: el sidebar sigue con las iniciales.
El registro MVP valida email, exige nombre no vacio y password con longitud minima de 8 caracteres; el cambio de password usa la misma politica minima.
La recuperacion de password vive en su propia entrada: [Recuperacion de password].
El usuario autenticado puede cambiar su password desde `Settings` definiendo un password nuevo; esto no exige conocer el password anterior y no equivale a recuperacion de password. Tras cambiarlo, Resender **cierra todas las demas [Sesion]es** ademas de la actual —un dispositivo que ya no controlas pierde el acceso—, lo envia a `login` y le indica que debe iniciar sesion con el password nuevo.
En `login`, los errores son genericos. En `register`, el email duplicado se informa de forma explicita.

### Recuperacion de password

Quien olvido su password la recupera sin ayuda: desde `login` pide un [Enlace de recuperacion] a su correo, elige una password nueva y vuelve a `login` a entrar con ella. **Resender nunca dice si un correo tiene cuenta**: la pantalla responde lo mismo exista o no, igual que los errores genericos de `login`.
Al completarla se cierran **todas** las [Sesion]es de esa cuenta —no solo las otras, como en el cambio desde Settings— y el correo queda marcado como verificado, porque el enlace probo que el buzon es suyo. Eso tambien deja la cuenta lista para vincular Google ([Cuenta vinculada]), igual que la [Verificacion de correo].
No confundir con el cambio de password de Settings, que exige [Sesion] abierta y no manda correo ([Usuario MVP]).

### Enlace de recuperacion

El enlace que viaja en el correo. **Vive una hora y sirve una sola vez**: usarlo lo consume, y pedir otro no invalida el anterior.
Su idioma es el de la pantalla donde se lo pidio, no el de la cuenta —no existe idioma por cuenta ([Preferencia de idioma])—.
Un enlace vencido o ya usado no es un error del formulario: es una pantalla propia que ofrece pedir uno nuevo, y se decide **antes** de mostrar el formulario para que nadie pierda el trabajo de elegir una password.

### Verificacion de correo

El alta con password manda un correo que pide confirmar la direccion. La sesion se abre igual, pero **una cuenta en el [Plan Free] no entra al producto hasta confirmar**: ver [Gate de correo del Free]. Una cuenta con suscripcion de pago `active` entra sin confirmar.
Ademas habilita vincular un proveedor social a esa cuenta ([Cuenta vinculada]). Una cuenta sin confirmar no se vincula, y esa es la puerta que cierra el robo de cuenta por registro anticipado.
Un alta por Google no manda este correo: Google ya dice que el buzon es suyo, y la cuenta nace con `email_verified = true`.
Completar una [Recuperacion de password] tambien confirma el correo, porque el enlace probo el buzon igual de bien.
El [Enlace de verificacion] aterriza en `/pending` (es su `callbackURL`), que ya hace lo correcto para todos: a quien tiene acceso y ya no necesita confirmar lo manda a `/connections`, a una cuenta del Free sin confirmar le pide confirmar, y a una cuenta en lista de espera le muestra la espera, con el bloque de confirmacion arriba si su correo sigue sin confirmar. Si el enlace vencio, `/pending` lo dice y ofrece reenviar. Una cuenta que paga y no confirmo no pasa por `/pending`: confirma y reenvia desde `Settings` ([Cuenta vinculada]).
`email_verified` se lee **vivo** contra la base (`lib/auth/email-verified.ts`), nunca de la [Sesion] ni de su cache, por la misma doctrina que el [Gate de acceso]: la libreria lo trae en `session.user`, pero ese cache dura cinco minutos y le seguiria diciendo "sin confirmar" a quien acaba de confirmar.

### Enlace de verificacion

El enlace que viaja en el correo de [Verificacion de correo]. **Vive 24 horas y sirve las veces que haga falta hasta que vence.**
No confundir con el [Enlace de recuperacion], que se le parece y **no tiene las mismas garantias**: aquel es una fila en `auth_verifications` que se consume al usarse y se puede invalidar borrandola; este es un **JWT firmado**, no deja fila en ninguna tabla, y por lo tanto **no se puede invalidar ni revocar**: solo vence. Dura mas justamente porque solo prueba un buzon, mientras que el de recuperacion cambia una credencial y por eso vive una hora.
Su idioma es el de la pantalla donde nacio, no el de la cuenta —no existe idioma por cuenta ([Preferencia de idioma])—: se resuelve por la cookie `lang` de quien lo pidio, con `es` de respaldo cuando no hay request.

### Canal de correo

Resender envia correo transaccional con **Resend**, desde `no-reply@resender.dev`, con respuestas a `info@resender.dev`.
La maqueta del correo vive como plantilla en Resend; **las palabras siguen en el diccionario del repositorio** (ADR 0006), y llegan a la plantilla como variables. Las copias del HTML que se pegaron en el editor de Resend estan versionadas en `docs/email/`: `password-reset.html`, `verify-email.html` y `account-linked.html`.
Manda tres tipos de correo, todos transaccionales: el de [Recuperacion de password], el de [Verificacion de correo] y el aviso de [Cuenta vinculada].
Un envio fallido **no se le informa a quien lo pidio** —decirlo revelaria que la cuenta existe—: se registra y la persona reintenta.

### Canal

Resender opera dos canales: `messenger` (páginas de Facebook) e `instagram` (cuentas profesionales de Instagram). El canal es un campo propio, **no** un valor de `provider`: Instagram es Meta —comparten la app, el sobre de error de Graph, la firma del webhook— y lo que cambia es la superficie. `provider` sigue valiendo `"meta"` en los dos.
Toda resolución de una cuenta por su id de Meta exige `channel` de forma **obligatoria y sin default**: los ids de página de Facebook y los de cuenta de Instagram viven en namespaces distintos, y un default convertiría "me olvidé de decidir" en "Messenger" sin que nadie lo note. Decisión en `docs/adr/0008-instagram-como-segundo-canal.md`.

### Cuenta conectada

`connected_pages` dejó de significar "páginas de Facebook" y pasa a significar **cuentas conectadas**: una página de Facebook o una cuenta de Instagram, discriminadas por [Canal]. En Instagram, `meta_page_id` guarda el **IG user id** (el que llega como `entry.id` en el webhook), `username` guarda el @handle y `token_expires_at` la fecha de vencimiento del token (los page tokens de Messenger no vencen; los de Instagram sí, ~60 días).
La unicidad es por `(channel, meta_page_id)`, no global: un mismo id repetido entre canales es legítimo.

### Ownership de páginas

Una página de Facebook conectada pertenece a un solo tenant y no hay transferencia automática de ownership. La regla vale igual para una cuenta de Instagram, y se evalúa **dentro de cada canal**: una cuenta de Instagram homónima de una página de Facebook no bloquea nada.
El ownership se evalúa **página por página**, no sobre la lista completa que devuelve Meta. Que una página ya esté tomada por otro tenant no invalida las demás: si Arturo conectó A y B, y Felipe —que también las administra— quiere conectar C y D, Felipe puede hacerlo. A y B le aparecen en la lista deshabilitadas, con un cartel de que ya están conectadas en otra cuenta. Se muestran en vez de ocultarse para que el usuario entienda por qué le falta una página que sí administra. Decisión en `docs/adr/0004-page-selection-and-per-page-ownership.md`.

### Conexión

Lo que ocupa un slot del plan: **una fila `active` de `connected_pages`, sea del canal que sea**. Una página de Facebook es una conexión; una cuenta de Instagram es otra; un número de WhatsApp será otra. Dos conexiones del mismo negocio ocupan dos slots: no hay agrupación por negocio, a propósito (`docs/adr/0011-cupo-por-conexion-e-instagram-en-facturacion.md`).
En pantalla se dice **conexiones**, nunca "páginas de Facebook". En el código todavía se llama `page`: `connected_pages`, `maxPages`, `countActivePages`, `page_limit_exceeded`, `/v1/pages`. Es deuda declarada en la ADR 0011, no un segundo concepto.

### Páginas conectadas por tenant

Cada tenant puede conectar múltiples páginas de Facebook, hasta el límite de su plan (ver [Límites por plan]). El límite cuenta **todas** las [Conexión]es `active`, sin mirar el canal: las desconectadas no ocupan cupo, pero reconectar una estando en el tope se bloquea igual que conectar una nueva. Conectar una cuenta de Instagram valida cupo **antes** del intercambio de OAuth, porque el `code` de Meta se quema al usarlo una vez.
Resender ya no conecta automáticamente todas las páginas que Meta devuelve. Ver [Selección de páginas].
La conexión sigue siendo all-or-nothing **sobre el subconjunto seleccionado**: antes de persistir, Resender verifica que el servidor pueda cifrar tokens y que las páginas sean conectables por ownership local, y exige que Meta confirme la suscripción al webhook de cada página elegida. Si alguna suscripción falla, no se guarda ninguna.

### Selección de páginas

Entre el callback de Meta y la conexión hay una pantalla donde el usuario elige qué páginas conectar, dentro del límite de su plan —o, para un [Cliente], dentro de su [Cupo del cliente]: la cabecera dice «tu tope», los huecos restantes son los que caben en su tope y en el plan del padre, y el rechazo del servidor nombra al padre en vez del plan—.
La pantalla **solo agrega**: desmarcar una página ya conectada no la desconecta. Desconectar sigue siendo una acción explícita con confirmación en `Connections` (ver [Gestion de paginas en Connections]), para que el flujo de reconexión no pueda desconectar páginas por accidente.
Para que los page access tokens de las páginas descartadas nunca lleguen a la base, Resender persiste cifrado el **user access token de larga duración** que ya obtiene en el intercambio de OAuth. La pantalla muestra solo `id` y `name`; al confirmar, Resender vuelve a llamar `/me/accounts` con ese token y guarda únicamente los page tokens de las páginas elegidas. Efecto colateral útil: agregar una página más adelante no exige repetir el OAuth de Meta.

### Reconexión de páginas

Si una página ya conectada pertenece al mismo tenant y se vuelve a autorizar en Meta, la reconexión es idempotente: actualiza token, nombre y `updatedAt`.

### Desconexión de páginas

Desconectar una página elimina o desactiva la conexión para futuros envíos y recepciones, pero conserva el historial de conversaciones y mensajes como bitácora.
La baja del webhook en Meta se despacha **por canal**: una cuenta de Instagram se da de baja contra `graph.instagram.com` y no contra el Graph de Facebook. Mandar el token de Instagram al endpoint de Facebook no da un error claro, da un `400` que se registra como "Meta no confirmó" y deja la cuenta recibiendo eventos.

### Permiso de Instagram

El canal Instagram tiene una bandera por cuenta, `users.instagram_enabled`: `true` es acceso, `false` no. Desde la `0024` nace en `true` y todas las cuentas existentes quedaron en `true`, asi que hoy no filtra a nadie; sigue cableada para cerrar el canal a una cuenta puntual **por SQL** (`update users set instagram_enabled = false where email = '...'`), no hay pantalla de administracion y nadie se anota en ninguna parte. **No** es una lista de espera: no confundir con el [Gate de acceso] ni con la [Lista de espera] publica.
Nacio (ADR 0010) porque Instagram estaba implementado sin el Advanced Access de Meta y el canal solo servia para cuentas propias o de prueba; ese cierre por defecto se levanto en la `0024`.
El permiso apaga el canal **entero y en el acto**, no solo la puerta de entrada: sin el no se conecta, no se envia, no se responden comentarios y los entrantes se descartan sin persistir, incluida una cuenta que ya estaba conectada. Se lee vivo contra la base en cada request, nunca de la [Sesion] ni de su cache, y es fail-closed. Vive en `lib/auth/channel-access.ts`, no en `lib/auth/waitlist.ts`, que volvio a estar en uso con la `0019`.
La migracion `0015` habilito a **todas las cuentas que existian**, igual que hizo la `0004`, y la `0024` volvio a hacerlo ademas de cambiar el default. El [Permiso de WhatsApp] sigue cerrado por defecto.
Decision en `docs/adr/0010-permiso-de-instagram-por-cuenta.md`.

### Instagram sin permiso

Lo que ve y recibe un tenant sin el [Permiso de Instagram]:

- **Conexiones**: si no tiene ninguna cuenta de Instagram conectada, el canal **no se renderiza** —ni el boton de la cabecera ni la tarjeta del estado vacio—. Si la tiene (le revocaron el permiso), la tarjeta deja de decir "activa" y muestra **sin acceso**. La regla es: no se ofrece lo que no se puede dar, pero no se esconde lo que ya tenias.
- **Inbox**: no cambia. El historial de Instagram ya recibido se sigue viendo; simplemente no entra nada nuevo.
- **API**: `403` con el codigo de contrato `channel_not_enabled`, generico a proposito porque WhatsApp va a necesitar el mismo. El `message` si nombra el canal.
- **Webhook entrante**: se responde `200` a Meta, no se persiste ni se reenvia nada, y queda `reason: "channel_not_enabled"` en la bitacora. El mensaje de esa persona se pierde a proposito. Quitar el permiso **no** desuscribe la cuenta en Meta: los eventos siguen llegando y se descartan uno por uno.

### Conexión de Instagram

Instagram se conecta con **Instagram API con Instagram Login** (`graph.instagram.com`), no con la variante que cuelga de una Página de Facebook: el negocio inicia sesión con su cuenta profesional y no necesita tener ni vincular una Página.
Los permisos van explícitos en el diálogo (`scope`) y no en un `config_id`: `instagram_business_basic`, `instagram_business_manage_messages` e `instagram_business_manage_comments`.
El OAuth **autoriza exactamente una cuenta**, así que no hay pantalla de [Selección de páginas]: el callback persiste directo. El orden es intercambio de código → perfil → suscripción al webhook → persistencia; una cuenta guardada que no recibe eventos se ve conectada y está muda, mientras que una suscripción sin fila en la base no le hace nada a nadie.
El token de larga duración de Instagram vence a los ~60 días y se guarda su `token_expires_at`. **Todavía no hay job de refresh**: es deuda conocida, no una decisión.

### Webhook de Instagram

Instagram tiene **ruta y secreto propios**, separados de los de Messenger: `INSTAGRAM_APP_SECRET` no es `META_APP_SECRET`. Compartir la ruta obligaría a adivinar con cuál secreto verificar cada payload. Cada webhook se registra por separado en el panel de Meta, con su propio verify token, suscrito a los campos `messages` y `comments`.
Ruta: `/api/meta/instagram/webhook`. El resto —verificación HMAC sobre el body crudo, dedupe por índice único, resolución cuenta→tenant, gates, bitácora de entregas y política de reintentos— es el mismo que el de Messenger.

### DM de Instagram

Los mensajes directos de Instagram usan las mismas tablas `conversations` y `messages` que Messenger; el canal se deriva de la cuenta conectada. El contacto se identifica por su **IGSID**, igual que el PSID en Messenger.
Dos eventos se descartan y no se persisten: `is_echo` —los mensajes que manda la propia cuenta vuelven como evento entrante, y sin filtrarlos el sistema se responde a sí mismo en bucle— y `is_deleted`, que es un envío que el usuario deshizo y no un mensaje nuevo.

### Comentario de Instagram

Los comentarios viven en su **tabla propia** `instagram_comments`; `conversations`/`messages` quedan solo para DMs. Un comentario cuelga de una publicación (`mediaId`), se anida en un hilo (`parentIgCommentId`) y su respuesta pública no tiene ventana de 24 horas: meterlo en `messages` habría pedido media docena de columnas nullable y una semántica prestada.
Un comentario entrante se persiste y se reenvía al `webhookUrl` del tenant igual que un mensaje, y comparte con él la bitácora `external_webhook_deliveries`, que desde la migración `0013` acepta **un mensaje o un comentario**, exactamente uno de los dos.
Los comentarios que publica el propio Resender vuelven por el webhook y se descartan con **tres** señales, porque en comentarios no existe `is_echo`: que el autor sea la propia cuenta (`from.id === entry.id`), que el @handle coincida con el de la cuenta conectada, y —la única que no depende del `from` que manda Meta— que ese id de comentario sea de una fila `outbound` nuestra.

### Respuesta a un comentario

Son **dos** operaciones distintas y Meta las trata como tales:

- **Respuesta pública**: se publica debajo de la publicación, no tiene ventana, se pueden mandar las que se quieran y se persiste en `instagram_comments`.
- **Respuesta privada**: es un **DM** a quien comentó, se persiste en `messages` con `instagram_source_comment_id`, tiene una ventana de **7 días** desde el comentario y Meta admite **una sola por comentario**. Es la única forma de escribirle primero a alguien que nunca mandó un DM.
  El destinatario **no lo elige el cliente**: el body es `{ pageId, commentId, reply }` y no acepta `recipientId`. En la respuesta privada el IGSID sale del comentario guardado; aceptarlo del cliente habría dejado mandarle un DM a cualquiera amparándose en un comentario ajeno.
  `commentId` es el id **de Meta** y no el uuid de Resender: es el que el tenant siempre tiene, porque le llegó en el push y además lo ve en Instagram. Se exige que el comentario esté en la bitácora; si no está, es `404`.
  El límite de una respuesta privada se verifica **contra nuestra propia base antes de llamar a Meta** y se devuelve como `409` con el id del mensaje que ya salió. Meta lo rechaza con un `100/2534025` que junta cuatro causas —pasaron 7 días, ya contestamos, borraron el comentario, esa persona no acepta mensajes— y no dice cuál. Solo cuentan los envíos que Meta aceptó: un intento fallido no consume la única respuesta disponible.

### Límite de texto por superficie

Tres superficies, tres límites, y dos unidades distintas:

| Superficie                                                                                                                                                                                                                                                                                                                                                                       | Límite                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Mensaje de Messenger                                                                                                                                                                                                                                                                                                                                                             | 2000 caracteres                   |
| DM de Instagram                                                                                                                                                                                                                                                                                                                                                                  | **1000 bytes UTF-8**              |
| Comentario de Instagram                                                                                                                                                                                                                                                                                                                                                          | **2200 caracteres** (code points) |
| Se validan antes de llamar a Meta y el `400` dice el número exacto, porque el rechazo de Meta no dice cuánto sobró. La unidad importa: en español cada acento son 2 bytes y cada emoji 4, así que 501 "ñ" son 1002 bytes y un control por `length` los dejaría pasar; al revés, un comentario de 1200 emojis son 1200 caracteres que Instagram acepta y que `length` rechazaría. |

### Traduccion de errores de Meta

Resender traduce el sobre de error de Graph a un mensaje accionable. Hay **tres catálogos** —Messenger, DM de Instagram y comentario de Instagram— y no uno solo: los códigos coinciden pero lo que el usuario tiene que hacer es distinto, y ese es el punto entero de traducir un error. Un `10` es la ventana de 24 h en un DM y un permiso faltante en una respuesta pública, que no tiene ventana; un `190` es "revocaron permisos, reconectá la Página" en Messenger y "el token venció solo, reconectá la cuenta" en Instagram.
Los tres motivos que no dependen de qué se estaba enviando —token vencido, rate limit, bloqueo por política— viven una sola vez y se comparten, para que no se separen con el tiempo.
En Messenger, un [Adjunto de salida] suma dos traducciones propias: formato no permitido (`546`) y URL inalcanzable para Meta (`100` / `2018047`). El resto de fallos de adjunto cae en el mensaje genérico.

### Instagram dentro de facturacion

Instagram está **dentro de facturación, completo**: ocupa cupo como cualquier [Conexión], sus entrantes y salientes suman [Mensaje contabilizado], y se frena cuando el tenant queda [Cuenta restringida]. No hay excepción por canal (`docs/adr/0011-cupo-por-conexion-e-instagram-en-facturacion.md`).
Los **comentarios** reciben el mismo trato que un DM: un comentario entrante persistido suma 1 y una respuesta que Meta acepta suma 1, sea pública o [Respuesta a un comentario] privada. Consecuencia asumida: un post con muchos comentarios puede consumir buena parte de la cuota del período, y el negocio no eligió recibirlos.
Sin suscripción de pago el tenant está en el [Plan Free] y le aplican los mismos límites, Instagram incluido (ADR 0022). Ya no hay gate de suscripción que descarte entrantes.

### Entrega de entrantes al sistema externo

El MVP usa `push`: tras persistir un mensaje entrante, Resender lo reenvía de forma no bloqueante al sistema externo del tenant.
La URL de destino externo se configura por página. Si una página no tiene `webhookUrl`, el mensaje entrante se persiste igual y aparece en la bitácora, pero no se reenvía.
La `webhookUrl` debe usar HTTPS para destinos reales; HTTP queda reservado a desarrollo local.
El payload reenviado al sistema externo incluye contexto minimo pero rico de `tenant`, `page`, `conversation` y `message`.
Un tenant recibe **mensajes y comentarios en el mismo endpoint**, así que el payload abre con un discriminador `type: "message" | "comment"`; el segundo trae `comment` en lugar de `conversation` + `message`. Y `page` lleva siempre `channel` y `username` —`username` va `null` en Messenger—, porque un tenant con los dos canales apuntando al mismo webhook necesita distinguir de cuál vino el evento y una forma uniforme se consume más fácil que una que cambia según el canal. Un [Inbound message] puede traer un [Adjunto] en `message.attachment` (singular, forma fija: `type`, `url`, `title` y un objeto `details` con lo específico del tipo — `stickerId`, `reelVideoId`, `postId`, la reserva, el producto, `rawType` cuando el tipo es `unknown`, `droppedCount` si se descartó un adjunto extra). `message.text` sigue siendo string —vacío si no hubo texto— para no romper consumidores. Los campos nuevos son **aditivos**: no rompen a los consumidores existentes.

### Pausa de reenvío

Interruptor, por [Conexión] y por conversación, que **deja de reenviar** los entrantes al webhook del tenant sin tocar nada más: el mensaje o comentario se persiste, aparece en Inbox y cuenta como [Mensaje contabilizado]; el envío por la [API externa de salida] sigue funcionando. Es un `skipped` en la bitácora de entregas con motivo `connection_paused` o `conversation_paused`, el mismo trato que «sin `webhookUrl`» o [Cuenta restringida]. Lo que llega durante la pausa **no se encola**: al reanudar no se reenvía nada de lo anterior. Solo se decide al ingerir; un evento que ya estaba en la cola de reintentos al pausar sale igual.

### Evento de pausa

Cada cambio de [Pausa de reenvío] **de una conversación** queda como una fila en `conversation_pause_events` (`paused` true/false y `created_at`), además del `paused_at` que lee la ingesta. Es el historial: `paused_at` solo dice el estado de ahora y se borra al reactivar. El hilo de [Inbox] lo intercala con los mensajes. Pausar lo ya pausado no escribe evento. La pausa de conexión no tiene eventos: no hay hilo donde contarlos.
Los dos niveles son independientes y la conexión es la **llave maestra**: pausada, no sale nada suyo —DMs ni comentarios— sin importar el estado de cada conversación; reanudarla no reanuda las conversaciones pausadas una a una. Reenviar = conexión activa **y** conversación activa.
La pausa de conversación se lee como **pausar a este contacto**: en Instagram también corta sus comentarios, porque `from_ig_id` es la misma identidad que `contact_id`. Un comentario de alguien que nunca escribió por DM no tiene conversación que pausar y se reenvía.
Se guarda en `paused_at` (migración 0025): null es activa, una fecha es «pausada desde». No es un valor de `status`: pausar no es [Desconexión de páginas], la conexión sigue activa y ocupando cupo. Solo desde la consola; la API pública no lo expone. Decisión en `docs/adr/0020-pausa-de-reenvio-al-webhook.md`.

### Firma del push

Cada POST al webhook del tenant lleva tres cabeceras: `resender-event-id`, `resender-timestamp` (epoch en segundos) y `resender-signature` (`v1=<hex>`). La firma es `HMAC-SHA256(secreto, "<eventId>.<timestamp>.<cuerpo crudo>")`.
Se firma el **eventId y el timestamp además del cuerpo**, no el cuerpo solo: sin el eventId, una firma válida sirve para reenviar otro cuerpo identico como si fuera un evento nuevo; sin el timestamp, una firma capturada vale para siempre. El receptor debe rechazar un timestamp fuera de una ventana de ~5 minutos y comparar la firma en tiempo constante.
El secreto es por **conexión**, no por tenant: se genera solo al guardar por primera vez una `webhookUrl`, y se muestra **una sola vez**. En base se guarda cifrado con `TOKEN_ENCRYPTION_KEY`, así que no hay forma de recuperarlo — solo de rotarlo desde `Connections`, lo que invalida el anterior.
Las conexiones anteriores a la firma siguen recibiendo el push **sin firmar** hasta que alguien pulse `Generar`. Dejar de entregarles por un secreto que nunca se les pidió seria romperles el producto para mejorarles la seguridad. La UI dice cuáles están sin firma.
El `eventId` es determinista y sale del uuid del sujeto, así que el mismo evento reingerido produce el mismo id: sirve para deduplicar del lado del receptor.

### API externa de salida

La API externa de salida usa API key opaca por header `Authorization: Bearer ...`.
`POST /api/meta/send` recibe exactamente uno de `reply` (texto) o un [Adjunto de salida], y acepta **dos formas** de destino: `conversationId` solo (el `conversation.id` del push; Resender resuelve página, token y contacto), o `pageId` + `recipientId` para iniciar una conversación. Si vienen los tres, deben coincidir o es `400`. Un `conversationId` desconocido para el tenant es `404`; uno que pertenece a otro canal que el de la ruta es `400`.
Los mensajes salientes se persisten tanto en exito como en fallo, usando `status` para distinguir el resultado del envio.
Instagram no agrega un campo `channel` al endpoint de Messenger: usa **rutas propias**, que son las de Facebook con `/instagram` insertado: `POST /api/meta/instagram/send` (DM, mismo body que Messenger, donde `pageId` es el IG id de la cuenta), `POST /api/meta/instagram/comments/reply` (respuesta pública) y `POST /api/meta/instagram/comments/private-reply` (DM al que comentó).
El body de un DM de Instagram es el mismo que el de Messenger, pero un [Adjunto de salida] se rechaza: ese canal todavía no los acepta.
Las tres rutas de salida de Instagram comparten la API key del tenant, el header `Idempotency-Key` y la persistencia en éxito y en fallo.

### Adjunto

Un archivo o tarjeta que viaja en un mensaje. En **salida** solo existen cuatro tipos por URL (`image`, `video`, `audio`, `file`): ver [Adjunto de salida]. En **entrada**, solo Messenger y en este alcance, se acepta el catálogo de Meta: `image`, `audio`, `video`, `file`, `sticker`, `reel`, `ig_reel`, `post`, `ig_post`, `fallback`, `appointment_booking`, `template`, o `unknown` si llega un tipo nuevo. El push al tenant lo entrega como un solo `message.attachment` de forma fija; si Meta manda el sticker duplicado (`image` + `sticker` hasta agosto 2026) se conserva el `sticker`.
La fila de `messages` admite texto, adjunto, o los dos: el XOR vale solo al _enviar_. Se guarda tipo, URL si la hay, y el resto del payload de Meta (`title`, `stickerId`, reserva, producto) en metadatos. Un tipo que no conocemos se persiste como `unknown`. La URL del adjunto no se escribe en logs: el type basta para diagnosticar.

### Adjunto de salida

Un [Reply] cuyo contenido no es texto sino un archivo de tipo `image`, `video`, `audio` o `file`. Se entrega como URL pública `https` que Meta descarga; Resender no sube, no hospeda y no descarga la URL para validarla ni para el preview. Es mutuamente excluyente con el texto del reply: un request lleva uno o el otro. El [Límite de texto por superficie] no aplica. En la bitácora se guarda el tipo y la URL, no un texto. Instagram aún no acepta adjuntos.

### Semantica visual de Inbox

En la bitacora, el color representa direccion: el entrante va en blanco con borde neutro y el saliente relleno del [Primario]. Si un saliente falla, la burbuja se vacia y se orla en rojo, y el metadato dice `entrega: no entregado`. El metadato bajo la burbuja lleva direccion traducida y hora (`entrante · 14:01`, `respuesta · 14:02 · entrega: leido`); en comentarios va encima y nombra al autor (`@juanpi · 14:02`) o dice `respuesta publica`. Vale igual para un DM y para una respuesta publica a un comentario: los dos son un ida y vuelta con la misma persona y se leen con las mismas burbujas. Un [Adjunto] se muestra por su tipo sin cambiar color ni dirección: preview de imagen, video o audio cuando hay URL usable; si no, una fila con el tipo y el título o id. Si el mensaje trae texto y adjunto, se ven los dos.

### Estructura de Inbox

La seccion se llama `Inbox` y vive en `/inbox`. `/messages` sigue respondiendo con un 308 hacia ella, arrastrando el query string. Tiene **dos modos** en `?tab=`: `mensajes` (el de por defecto, que se omite de la URL) y `comentarios`. El modo es un enlace, no estado de React, y por eso la pantalla entera sigue siendo server component.

En **mensajes**, `Inbox` se organiza como lista de conversaciones mas vista de hilo. Cada conversacion corresponde a una cuenta conectada y un contacto.
Las conversaciones se ordenan por `lastMessageAt desc` y, al entrar, se abre automaticamente la conversacion mas reciente.
Cuando un tenant tiene multiples cuentas conectadas, `Inbox` muestra por defecto conversaciones de todas, con un filtro visible por cuenta. Un [Padre] con [Cliente]s tiene ademas el [Filtro por cliente] al lado, y cada fila y cabecera de hilo de una cuenta de cliente lleva la etiqueta con su nombre; el filtro de cuentas solo lista las del cliente elegido. Un [Cliente] ve solo lo de sus conexiones, sin filtro ni etiquetas.
El contacto se identifica por su **@handle**. Ninguno de los dos webhooks lo trae —el de DMs manda `sender.id` a secas— asi que se pide a Graph y se cachea en `conversations.contact_username` / `contact_name` (migracion 0014). El PSID/IGSID crudo queda de caida: en Messenger no hay perfil que pedir, y en Instagram Graph puede no resolver el contacto.
Cada fila y la cabecera del hilo llevan **badge de canal**: con Messenger e Instagram en el mismo log, dos filas de cuentas distintas solo se distinguian por el id. En las filas y en la cabecera del hilo la cuenta se nombra a secas —`@handle` en Instagram, numero en WhatsApp, nombre en Messenger—; el `@handle · ig_id` con el id de soporte queda para `Connections`. La respuesta privada a un comentario es un DM como cualquier otro y aparece en su conversacion; lo unico que la distingue es el sufijo `· respuesta a comentario` en el metadato de la burbuja, que sale de `messages.instagram_source_comment_id`.

En **comentarios**, la unidad de la lista es la **publicacion**, no el comentario suelto ni el contacto: un comentario cuelga de un post y fuera de ese hilo no significa nada. Cada fila muestra el ultimo comentario, el caption de la publicacion y el total; el panel derecho lista los comentarios de esa publicacion en orden cronologico ascendente, entrantes y respuestas publicas, incluidas las que Meta rechazo. La seleccion vive en `?media=<connectedPageId>:<mediaId>`, el par y no el `media_id` solo porque un id de Meta solo es unico dentro de la cuenta que lo publico. El filtro de cuentas lista **solo Instagram** en este modo: Messenger no tiene comentarios y una pildora que siempre devuelve cero es un control muerto.

El webhook de comentarios solo trae `media.id` y `media_product_type`, asi que el **caption y el permalink** se piden a Graph y se cachean en `instagram_media` (migracion 0014). La cabecera del hilo enlaza al post en Instagram: como no hay compositor, abrir el post es lo que el usuario necesita para contestar de verdad. Mientras no esten resueltos —o si Meta no los devuelve— la publicacion se nombra por su clase y su id, que es lo que se cita en soporte.

Las dos resoluciones —@handle y publicacion— corren al **leer la pantalla**, no al ingerir el webhook: asi las filas que ya existian se completan la primera vez que alguien las mira, y una caida de Graph no puede hacer fallar la recepcion de un mensaje. El intento se sella aunque falle, para no volver a pedir lo mismo en cada render.

Los dos modos son de **solo lectura**: no hay compositor en ninguno, las respuestas salen por la API externa. Decision en `docs/adr/0009-inbox-mensajes-y-comentarios.md`.

En **mensajes**, la cabecera del hilo lleva a la derecha el interruptor de [Pausa de reenvío] de esa conversacion, solo la etiqueta `Automatización` y el switch, sin texto de estado, y la fila de la lista muestra un icono de pausa junto al contacto para verlo sin abrirla. El **desde cuándo** no va en la cabecera sino dentro del hilo: cada vez que alguien pausa o reactiva queda un [Evento de pausa] dibujado entre las burbujas, en el instante en que ocurrio (`Automatización pausada desde el 14 sept 2026, 10:32` / `Automatización activada desde el …`), con fecha absoluta y para siempre. Asi se lee que mensajes llegaron con el bot apagado. No hay marca por mensaje de «no reenviado»; eso queda en la bitacora de entregas.

### Primario

El único color de marca de la interfaz: el violeta `#7673A4`, igual en claro y en oscuro. Pinta el botón principal de cada pantalla, los enlaces, el foco y las burbujas salientes del [Inbox]; todo lo demás es neutro (blanco, grises, negro `#252525`) o una semántica (éxito, aviso, error, info).
El mock lo llama «acento» porque lo expone como un selector que se puede cambiar; en Resender no se usa esa palabra: _acento_ en shadcn es el gris de hover de menús y listas, y llamar «acento» al violeta confunde las dos cosas. En código el primario es `primary`.

### Pantallas de configuracion

La gestion de paginas conectadas no vive dentro de `Settings` en el MVP; se realiza en una pantalla separada.
La pantalla separada se llama `Connections` y vive en la ruta `/connections`.
`Settings` queda limitado a cuenta y API keys en el MVP.

### Gestion de paginas en Connections

`Connections` es la pantalla operativa de Meta. Cada pagina conectada puede mostrar y editar su `webhookUrl`, ademas de desconectarse.
Los dos canales conviven en la misma lista. El **badge de canal va primero** en cada tarjeta: con dos canales mezclados es el dato que ordena todo lo demas. Instagram muestra `@handle · ig_id` y Messenger sigue mostrando `page_id`. El boton "Conectar Instagram" es secundario (`outline`) junto al de Facebook: dos primarios lado a lado no dicen cual es el camino habitual.
La `webhookUrl` se guarda con accion explicita mediante boton `Guardar`.
Desconectar una pagina requiere confirmacion explicita y debe advertir que se conserva el historial.
Cada conexion activa lleva el interruptor de [Pausa de reenvío] pegado al bloque del webhook, con el estado en claro al lado (`Automatización: Activa` / `Pausada desde hace 2 h`) y una pildora `automatización pausada` junto al estado. En pantalla se llama «Automatización», nunca «webhook» ni «reenvío»: es el vocabulario del cliente. Encendido es «reenviando». Se ofrece tenga o no `webhookUrl`; no en una desconectada. Sin confirmacion: es reversible al instante.
Un [Cliente] ve la misma tarjeta **sin** el bloque de webhook y secreto: el webhook es del padre. Conserva el switch y desconectar, solo sobre sus propias conexiones, y el contador de la cabecera es `conectadas / tope` en vez del cupo del plan.
El [Padre] ve las conexiones de sus clientes en la misma lista, con la etiqueta del cliente junto al badge de canal y el [Filtro por cliente] en la cabecera; la tarjeta es la completa, webhook incluido.

### Gestion de API keys en Settings

Cada API key tiene `label` y su valor secreto se muestra **una sola vez, en el momento de crearla**; despues solo queda visible su metadata no secreta.
La lista de API keys muestra `label`, prefijo visible corto, `createdAt` y estado. **No muestra ultimo uso**: mantener ese dato costaba una escritura por request sobre la fila de la key —el plugin la hace en cada `verifyApiKey`, sin opcion de apagarla— y nadie tomaba decisiones con el. Por eso `authenticateApiKey` lee la fila por el adaptador del plugin y no escribe nada. La columna `last_used_at` sigue en la tabla porque el plugin la declara; queda como deuda borrarla si algun dia se deja el plugin.
Una API key revocada sigue visible en la lista con estado `revoked`; deja de autenticar, pero no desaparece del historial operativo. La lista **no muestra cuando se revoco**: el plugin `apiKey` no guarda esa fecha y mostrar cualquier otra seria inventarla.
Una key solo se puede revocar **dentro del tenant que la emitio**: pedir la revocacion de una key ajena responde "no encontrada" y no la toca.
A las API keys se les habla **solo desde el servidor**. El plugin `apiKey` monta ademas seis endpoints HTTP bajo `/api/auth/api-key/*` (`create`, `update`, `delete`, `get`, `list`, `delete-all-expired-api-keys`) que el producto no usa y que estan cerrados con 404 en el route handler de `/api/auth/[...all]`. El que obliga es `delete`, que hace **borrado duro** de la fila: dejarlo abierto contradiria la regla de arriba, porque el propio dueño podria hacer desaparecer una key del historial operativo desde la consola del navegador. Los otros cinco se cierran junto con el para que la regla sea una sola y no una excepcion.
Cada API key autentica acceso a todas las paginas del tenant; no existen restricciones por pagina en esta version.

### Cuenta de revision

Para Meta App Review, Resender usa una cuenta de revision preconfigurada en lugar de pedirle al revisor que haga onboarding desde cero. Esta cuenta representa un tenant de Resender y debe tener una pagina de Facebook de prueba ya conectada, una `webhookUrl` configurada y una automatizacion demo activa que responda por la API externa de salida. Las credenciales compartidas con Meta son solo de Resender; no se comparten credenciales personales de Meta/Facebook.

### Page de revision

La Page de revision es la pagina de Facebook conectada dentro de la cuenta de revision. Los mensajes no llegan al usuario de Resender directamente: llegan a esta Page, Resender los persiste en la bitacora y los reenvia al sistema externo configurado. El revisor debe poder enviar un DM a esta Page y ver en Resender que aparece la conversacion, junto con la respuesta enviada de vuelta por Messenger.

### Usuario Messenger de prueba

El Usuario Messenger de prueba es una cuenta de Facebook controlada por Lorna Suriano Hernandez/Resender que se usa para grabar el screencast y enviar DMs a la Page de revision mientras la app esta en modo Development o pendiente de aprobacion. Esta cuenta debe tener el rol/relacion necesaria en Meta para que sus mensajes lleguen al webhook antes de que `pages_messaging` este aprobado en Live. No se comparten credenciales personales de Facebook/Messenger con Meta; al revisor se le entrega la cuenta de revision de Resender y pasos claros.

### Automatizacion demo

La automatizacion demo es el sistema externo conectado al `webhookUrl` de la Page de revision. Su objetivo no es cambiar el modelo de producto ni convertir Resender en bot, sino demostrar durante App Review que el flujo completo de `pages_messaging` funciona: DM entrante, persistencia, push externo, respuesta por `/api/meta/send` y recepcion del mensaje en Messenger.

### Identidad legal

La entidad que opera Resender es **Lorna Suriano Hernandez**, con sede en Argentina. `Resender` es el nombre del producto; `Lorna Suriano Hernandez` es la entidad responsable que figura en los documentos legales (politica de privacidad, terminos).

### Responsable y Encargado (roles de privacidad)

Resender trata dos clases de datos con roles distintos. Para los datos de la cuenta/`tenant` (los clientes de Resender), **Lorna Suriano Hernandez es el responsable**. Para los mensajes de usuarios de Messenger que escriben a las paginas de los tenants, **Lorna Suriano Hernandez actua como encargado/procesador en nombre del tenant**, que es el responsable de esas conversaciones. Este reparto determina que las obligaciones de cara al end-user recaen sobre el tenant, no sobre Lorna Suriano Hernandez.

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
El canal de Instagram **no altera este envio**: se desarrollo contra una app de Meta separada ("Resender.dev - Test1") y necesita su propia revision de `instagram_business_manage_messages` e `instagram_business_manage_comments` (Advanced Access + verificacion de negocio) antes de servir cuentas de terceros. Hasta entonces solo funciona con cuentas propias o de prueba en Standard Access.
Los permisos viven en el `config_id` de Facebook Login for Business, no en codigo. El `config_id` usado para esta revision es nuevo y dedicado a este envio de Messenger; quedo configurado solo con `pages_manage_metadata`, `pages_messaging` y `pages_show_list`. En particular, `business_management` queda fuera del alcance de Messenger porque Resender no administra Business Manager, WABAs, cuentas publicitarias ni assets de negocio en este flujo. El panel de Meta debe mantenerse alineado con el alcance real del producto: listar paginas autorizadas, suscribir/desuscribir paginas al webhook y enviar/responder mensajes de Messenger.
El dominio canonico para el envio es `resender.dev`. Las URLs publicas que deben cargarse en Meta Dashboard son `https://resender.dev/privacy` como Privacy Policy URL y `https://resender.dev/data-deletion` como Data Deletion Instructions URL.

### Documentacion publica del flujo (`/docs`)

La pagina publica `/docs` documenta, en ingles y para developers externos, el flujo de integracion en 3 pasos. Vocabulario canonico en ingles (alineado con el modelo existente):

- **Channel** = pagina de Facebook conectada (ver [Gestion de paginas en Connections]). ⚠️ Este uso **colisiona** con el [Canal] del modelo de datos, donde `channel` vale `messenger` o `instagram`. Al reescribir `/docs` —que ya no vive en este repo— la cuenta conectada debe dejar de llamarse "channel".
- **Inbound message** = mensaje del cliente que Resender hace push al `webhookUrl` del developer (ver [Entrega de entrantes al sistema externo]). Tiene `direction: "inbound"`, `status: "received"`. NO se llama "response"/"respuesta".
- **Reply** = respuesta del developer al cliente via `POST /api/meta/send` (ver [API externa de salida]). Es texto o un [Adjunto de salida], nunca los dos.
  Resuelto: en el spec original "respuesta" apuntaba al mensaje que llega al webhook; eso es un **inbound message**, no una response. La unica "response" es el **reply** que sale por el endpoint.
  Gotcha documentado: la forma recomendada de responder es `conversationId` (el `conversation.id` del payload entrante); el gotcha de `pageId` = `page.metaPageId` (no el `page.id` interno) sigue aplicando al modo de inicio, donde `recipientId` = el `conversation.contactId` del payload entrante.

### Borrado de cuenta (account deletion)

"Delete account" en `Settings` borra **todo** el tenant (cuenta, paginas, conversaciones, mensajes, API keys); no hay borrado parcial en el MVP. Es inmediato y transaccional en produccion; los backups se purgan en ≤30 dias. Antes de borrar, se intenta best-effort dar de baja cada pagina activa del webhook de Meta. Requiere confirmacion destructiva (reescribir el email de la cuenta). Se implementa con FKs `on delete cascade` (migracion `0002`), que reemplazan el `on delete restrict` original. Cuidado: con cascade, borrar una fila de `connected_pages` arrastraria su historial; hoy nada borra paginas (ver [Desconexión de páginas], que es UPDATE no DELETE).

### Suscripcion (billing)

Usar el producto **no** requiere pagar: toda cuenta sin suscripcion de pago `active` esta en el [Plan Free]. Las suscripciones de pago las gestiona Stripe. Hay 3 planes mensuales en USD: **Starter $15**, **Pro $29** y **Business $199**. Solo ciclo mensual.
El plan **Business** se elimino en la ADR 0003 y vuelve en la ADR 0016 con un price nuevo en Stripe y la misma lookup key. Pro subio de $25 a $29 en la misma ADR.
La diferenciacion funcional entre planes ya no es binaria: cada plan trae una cuota de mensajes y un limite de paginas. Ver [Límites por plan]. Decisiones en `docs/adr/0002-stripe-checkout-subscriptions.md`, `docs/adr/0003-plan-entitlements-usage-quota.md`, `docs/adr/0016-tres-planes-pro-a-29.md` y `docs/adr/0022-plan-free-derivado.md`.

### Plan Free

El plan de toda cuenta **sin suscripcion de pago `active`**: recien registrada, cancelada, `past_due` o `unpaid`. Es **derivado**: no existe en Stripe ni tiene fila en `subscriptions`; lo decide el status al resolver el entitlement (`FREE_PLAN` en `lib/billing/plans.ts`). Da 2.000 mensajes por mes calendario UTC y 1 [Conexión]. El soporte por email y Discord es solo copy del pricing.
Pide el correo confirmado: ver [Gate de correo del Free]. No administra Clientes: si un padre con Pro o Business cae al Free, sus clientes quedan restringidos.
Al cruzar entre Free y un plan de pago el contador arranca de cero en los dos sentidos, porque cambia la clave del [Período de cuota]. Decisiones en `docs/adr/0022-plan-free-derivado.md`.

### Límites por plan

| Plan               | Precio | Mensajes por período | Conexiones |
| ------------------ | ------ | -------------------- | ---------- |
| [Plan Free]        | $0     | 2.000                | 1          |
| `starter_monthly`  | $15    | 50.000               | 2          |
| `pro_monthly`      | $29    | 100.000              | 5          |
| `business_monthly` | $199   | 1.000.000            | 40         |

Con suscripcion `active` el límite se resuelve desde `subscriptions.price_lookup_key` contra un mapa en código; sin ella, son los del [Plan Free]. Un `price_lookup_key` desconocido en una suscripcion `active` es fail-closed (no cae al Free), igual que el resto de los gates.

### Mensaje contabilizado

La cuota mide **ambas direcciones**: cada [Inbound message] persistido suma 1, y cada reply que Meta acepta (`status: 'sent'`) suma 1. Una conversación de ida y vuelta consume 2 unidades, así que los 50.000 del Starter son ~25.000 intercambios; los números publicados se mantienen sabiendo esto.
**No** consumen cuota: un envío que Meta rechaza (`status: 'failed'`) —el cliente no paga por un page token vencido nuestro ni por la ventana de 24h de Messenger— ni un replay idempotente, que no llama a Meta ni inserta mensaje nuevo.
Los entrantes **cuentan aunque no se entreguen**: si el tenant está restringido o la página no tiene `webhookUrl`, el mensaje se persiste igual y consume cuota. Lo que la cuota cubre es recibir y persistir, no entregar.
La cuota mide **todos los canales**, incluidos los DMs y comentarios de Instagram: ver [Instagram dentro de facturacion].

### Mensaje cobrado por Meta

Una respuesta de WhatsApp que **Meta le cobra al cliente**: desde el 1 de octubre de 2026, cada mensaje de servicio entregado después de los 1.000 gratis que Meta da por número al mes. Meta se lo factura directo a la tarjeta registrada en la WABA del cliente; **Resender no lo cobra, no lo revende y no le pone margen** (`docs/adr/0023-costo-de-meta-se-informa-no-se-cobra.md`). Sin método de pago en la WABA, Meta puede dejar de entregar (`131042`).
**No confundir con [Mensaje contabilizado]**, que es la cuota del plan de Resender: una misma respuesta de WhatsApp suma 1 a la cuota, la cobre Meta o no, y los dos contadores no se descuentan uno del otro. Los conteos de Meta que muestre Resender son informativos; la factura de Meta es la fuente de lo que se le debe.

### Período de cuota

En un plan de pago la ventana es el **período de facturación de Stripe**, no el mes calendario: el contador se resetea cuando cierra el ciclo que el cliente pagó, para no regalar una cuota completa a quien paga el día 28. Requiere `subscriptions.current_period_start`, que la migración `0005` no incluía. Sin período conocido no hay envío (fail-closed).
En el [Plan Free] la ventana es el **mes calendario UTC**: empieza el día 1 a las 00:00 UTC, sin cron.
El límite es un **tope práctico, no exacto**: como solo cuentan los envíos que Meta acepta, hay que llamar a Meta y después incrementar, y sin transacciones interactivas en el driver HTTP de Neon un puñado de requests concurrentes puede pasarse por decenas de mensajes.

### Cambio de plan

Entre planes de pago, el **upgrade se aplica inmediato**: sube el techo y **conserva el consumo** del período (quien gastó 50.000 y sube a Pro tiene 50.000 restantes, no 100.000). Así ciclar planes no sirve para resetear cuota, y un cliente bloqueado puede desbloquearse pagando en el acto.
El **downgrade se difiere** al cierre del período: quien pagó el mes lo usa completo, mismo criterio que `cancel_at_period_end`. El Customer Portal de Stripe debe configurarse para diferirlo; por defecto Stripe lo aplica inmediato con prorrateo.

### Cuenta restringida

Estado degradado con dos causas: **cuota agotada** o **exceso de conexiones** tras un downgrade (bajar a Starter con 5 [Conexión]es activas, o caer al [Plan Free] con más de 1). Como conectar valida cupo, el downgrade es la **única** vía de entrada al segundo caso.
En ambos casos el comportamiento es el mismo: los entrantes se siguen persistiendo en la bitácora, dejan de reenviarse al webhook del cliente, y el envío queda bloqueado **para todas las conexiones** del tenant —de cualquier canal—, no solo las excedentes. No desconectamos nada nosotros: desconectar es siempre acción del usuario, aunque eso deje al tenant apagado por completo mientras decide.
Se levanta al resolverse la causa: nuevo período de cuota, subir de plan, o el usuario desconecta conexiones hasta quedar dentro de su límite.

### Errores de límite en la API

Dos códigos distintos, porque la acción del cliente es distinta:

- `402 Payment Required` + `quota_exceeded` — se arregla subiendo de plan.
- `403 Forbidden` + `page_limit_exceeded` — se arregla desconectando conexiones. El código conserva el nombre viejo aunque ya no sean páginas; el `message` sí habla de conexiones (deuda declarada en la ADR 0011).
- `403 Forbidden` + `plan_unavailable` — fail-closed cuando no se puede resolver el plan (`price_lookup_key` desconocido) o el [Período de cuota]. No es una causa de negocio sino una inconsistencia de datos: se arregla del lado de Resender, y el `message` manda a soporte.

Cada uno con `message` legible. Se suman al contrato de errores `snake_case` de `prd_api_separation.md`. Se descartó `429`, que comunica velocidad y no cuota comprada.

### Aviso de cuota

A partir del **80%** del consumo del período aparece una barra de alerta **global en el dashboard**, no solo en `Connections`: quien no entra a esa pantalla no se entera.
El aviso no sale por correo en esta entrega: el [Canal de correo] existe, pero el aviso de cuota no se construyo. Pendiente: la FAQ pública promete "Te avisamos cuando te acercás al límite" dos veces en `content/i18n/es.ts`, que un cliente lee como email; hay que reescribirla para que apunte al dashboard.

### Gate de correo del Free

Es el **segundo** gate, detras del [Gate de acceso], y reemplaza al viejo gate de suscripcion (ADR 0022). Una cuenta del [Plan Free] sin el correo confirmado ([Verificacion de correo]) aterriza en `/pending`, que le pide confirmar; al confirmar entra al producto. Aplica al dueño en el layout de `(product)` y al conectar redes (`email_unverified` en el connect gate). Una suscripcion de pago `active` lo salta. La API y los webhooks entrantes no lo miran: los limitan la cuota y el cupo de conexiones. Se lee vivo contra la base (`lib/billing/free-plan-gate.ts`), nunca de la [Sesion].
Ya no hay muro de pago: un tenant sin suscripcion no rebota a `/billing`, no recibe `403 no active subscription` y sus entrantes se persisten. `/billing` es la pagina de upgrade.
Un cliente sigue dependiendo del padre: si el padre no tiene suscripcion de pago `active`, el cliente ve la cuenta restringida sin CTA de pago.

### Sin trial

No hay periodo de prueba de los planes de pago: el primer cobro ocurre dentro del propio Stripe Checkout y no existe logica de trial en ninguna capa (ni `trial_period_days` en Checkout ni flags propios en base de datos). Lo que hay para probar sin pagar es el [Plan Free], que no vence.

### Stripe Checkout y Customer Portal

Resender no maneja datos de tarjeta: la compra se hace en la pagina de Checkout hosteada por Stripe (redirect) y toda la gestion posterior (cambiar plan, actualizar tarjeta, cancelar) ocurre en el Customer Portal de Stripe, enlazado desde `Settings`. La cancelacion es `cancel_at_period_end`: quien pago el mes lo usa completo. El servidor solo crea sesiones de Checkout/Portal via API con la secret key.

### Webhook de Stripe

El estado de las suscripciones se replica en Postgres consumiendo webhooks firmados de Stripe en `app/api/stripe/webhook` (verificacion con `STRIPE_WEBHOOK_SECRET`, espejo del patron HMAC del webhook de Meta). Eventos relevantes: `checkout.session.completed` y `customer.subscription.created/updated/deleted`, procesados con upsert idempotente sobre la tabla `subscriptions`. En desarrollo se usa `stripe listen` (Stripe CLI) para recibirlos en local.

### Idioma

Resender es bilingue **espanol e ingles** en las dos superficies: el sitio publico y el producto. El espanol es el idioma por defecto y vive **sin prefijo** en la URL (`/pricing`); el ingles vive bajo `/en` (`/en/pricing`). Esa convencion no cambia.
**Lo que ves lo decide la URL**: un enlace `/en/...` compartido se ve en ingles siempre, sin importar la preferencia de quien lo abre.
El registro de voz sigue siendo distinto a proposito (landing en voseo, producto en tuteo neutro, ADR 0005); ser bilingue no unifica las voces.

### Preferencia de idioma

**No existe idioma por cuenta.** La cookie `lang` es lo unico que hay: gobierna el producto —que no se rutea por idioma, `/settings` e `/inbox` no tienen gemela `/en`— y la resuelve `lib/i18n/app-locale.ts`, que lee esa cookie y nada mas. En el sitio publico manda la URL, y la cookie solo decide a donde aterriza quien entra por la raiz `/`.
Los dos selectores —el del header publico (`components/language-toggle.tsx`) y el de `Settings > Language`— escriben esa misma cookie.
La raiz `/` si respeta la cookie y el `accept-language`: un visitante con el navegador en ingles aterriza en `/en`. El precio es que `/` deja de ser cacheable igual para todos.
Que la preferencia sea de navegador y no de cuenta tiene una consecuencia que se ve en el [Enlace de recuperacion]: su idioma es el de la pantalla donde se lo pidio, y quien pide el enlace desde otro dispositivo lo recibe en el idioma de ese otro dispositivo. Lo mismo vale para los correos de [Verificacion de correo] y [Cuenta vinculada]: salen en el idioma de esa cookie, con `es` de respaldo, porque su `callbackURL` es una ruta del producto sin gemela `/en` y no codifica idioma como si lo hace el de recuperacion.
**Deuda declarada:** hasta esta entrega, esta seccion afirmaba que existia una columna `users.locale` que gobernaba el producto y que el alta la sembraba. Nunca existio —no esta en ninguna migracion y ningun codigo la lee—. Crearla de verdad es una feature aparte: migracion, alta, selector de Ajustes y una query por request.

### Paginas legales

`/privacy`, `/terms` y `/data-deletion` son **unicas y en ingles**: quedan fuera del segmento de idioma, sin gemela `/en`, como ya las trata `app/sitemap.ts` (`SHARED_ROUTES`). Un documento legal traducido son dos documentos que mantener sincronizados, y una divergencia entre ellos es un problema juridico, no un typo.
