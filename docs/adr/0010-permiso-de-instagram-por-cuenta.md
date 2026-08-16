---
status: accepted
---

# Permiso de Instagram por cuenta: `users.instagram_enabled` y el canal apagado de punta a punta

Instagram está implementado y en el código desde la
[ADR 0008](0008-instagram-como-segundo-canal.md), pero no está listo para venderse a cualquiera.
Esa misma ADR lo dejó escrito: *«Instagram exige su propio Advanced Access de
`instagram_business_manage_messages` e `instagram_business_manage_comments`, con verificación de
negocio. Hasta entonces el canal solo sirve para cuentas propias o de prueba»*
(`0008-instagram-como-segundo-canal.md:106-109`).

Hoy no hay nada que lo impida. Las ocho superficies de Instagram heredan exactamente los mismos
tres portones que Messenger —sesión → acceso → suscripción activa— y ninguno pregunta por el canal:
`app/api/meta/instagram/start/route.ts:43`, `app/api/meta/instagram/callback/route.ts:66`,
`app/api/meta/instagram/send/route.ts:89`, `lib/outbound/comment-reply-request.ts:76` (que sirve a
`reply` y a `private-reply`), `lib/inbound/inbound-ingestion.ts:146` y `:390`, la UI de
`app/(product)/connections/page.tsx`, y el worker `apps/api` (`service.ts:179`). Cualquier cuenta
con suscripción activa puede conectar su Instagram ahora mismo.

Esta ADR agrega un **permiso por cuenta**: una bandera booleana que se prende y se apaga por SQL,
sin pantalla de administración, y que decide si el canal existe para ese tenant.

## El nombre otra vez

La [ADR 0007](0007-public-waitlist-and-access-gate-shutdown.md) ya pagó el costo de un nombre
ocupado: `waitlist` significaba a la vez el gate de acceso y la lista pública de captación, y
desambiguarlo costó una ADR entera. Esto **no** es «la waitlist de Instagram». No hay lista, no hay
espera declarada y nadie se anota. Es un permiso: el diccionario lo registra como
[Permiso de Instagram] y el gate apagado de la 0004 sigue siendo otra cosa.

## Considered Options

- **Tabla `tenant_channel_access (tenant_id, channel, enabled)`** — rechazada. Modelaba el canal
  como la dimensión que ya es en `connected_pages.channel` (`0013_instagram_channel.sql:26-27`) y
  WhatsApp habría entrado sin migración nueva, que no es poco: `prd_whatsapp.md:1-3` está «listo
  para implementación» y su resumen repite el mismo bloqueo palabra por palabra —*«Conectar
  negocios externos en producción queda bloqueado hasta que Meta apruebe los permisos»*
  (`prd_whatsapp.md:19`)—. Se cae por el lado operativo: dar acceso sería un `insert ... on
  conflict` con el `uuid` del tenant, y lo que se tiene a mano cuando alguien escribe pidiendo el
  canal es su correo. Además una fila ausente hay que interpretarla, y «ausente» es justo el estado
  en el que va a estar todo el mundo.
- **`users.enabled_channels text[]`** — rechazada. Una columna para todos los canales presentes y
  futuros, pero sin `check` que sirva: `'instgram'` mal escrito entra sin protestar y el canal
  queda apagado sin que nada lo diga. Un permiso que falla en silencio es peor que no tenerlo.
- **Permiso solo en la puerta de entrada** (comprobado únicamente en el OAuth) — rechazada. Sería
  un permiso de alta y no de uso: pasar la bandera a `false` no frenaría a quien ya conectó, y
  cortarle de verdad exigiría desconectarle la cuenta a mano.
- **Persistir los entrantes del tenant revocado sin reenviarlos**, como hace [Cuenta restringida]
  (`0003-plan-entitlements-usage-quota.md:66-68`) — rechazada. Devolver el permiso reconstruiría el
  hilo completo sin huecos, y el argumento de cuota no aplica porque Instagram hoy está fuera de
  facturación (`CONTEXT.md`, «Instagram fuera de facturacion»). Se cae por lo otro: seguiríamos
  guardando mensajes y comentarios de terceros —datos personales de gente que le escribe al
  negocio— en un canal que le revocamos a ese negocio.
- **Descartar el entrante y además desuscribir la cuenta en Meta** — rechazada. Cortaría el ruido
  de raíz en vez de tirarlo request a request, pero convierte un `UPDATE` reversible en una baja
  real contra Meta: volver a poner `true` no revive el canal, hay que rehacer el OAuth. Un `false`
  puesto por error pasaría a ser destructivo, y encima mete una llamada de red a Meta dentro del
  webhook, que tiene que responder `200` rápido o Meta lo desactiva.
- **Reusar el código de error `account_waitlisted`** — rechazada. Cero cambios de contrato, pero
  miente dos veces: la waitlist se apagó en la 0007, y el bloqueo no es de la cuenta sino de **un**
  canal —el Facebook del mismo tenant sigue funcionando—. Soporte recibiría capturas de un error
  que no se puede buscar en la documentación.
- **`404 not_found` para no revelar que el canal existe** — rechazada. Es indistinguible de un bug
  nuestro o de una URL mal escrita, y el repo ya eligió lo contrario cuando el motivo desconocido
  se muestra crudo antes que tragárselo (`lib/pages/meta-connection-error.ts:69`).
- **Ocultar también el historial de Instagram en el Inbox** de un tenant revocado — rechazada. Sería
  la regla más fácil de explicar —sin permiso, el canal no existe en la UI— pero le hace desaparecer
  conversaciones que vio ayer, y esas conversaciones son datos de su negocio, no una función que se
  le presta.

## Decisión

### La bandera vive en `users`

Migración `0015_instagram_access.sql`:

```sql
alter table users
  add column instagram_enabled boolean not null default false;

update users set instagram_enabled = true;
```

Gemela exacta de `users.waitlisted` (`0004_users_waitlist.sql:8`) y por el mismo motivo: dar acceso
es un `update users set instagram_enabled = true where email = '...'`, con el correo que la persona
acaba de escribir, y la lectura viaja en la misma fila que las rutas ya consultan.

El costo está aceptado y es doble: WhatsApp va a pedir su propia columna con su propia función casi
idéntica, y `users` se convierte de a poco en un panel de permisos por canal.

### Toda cuenta que existe hoy queda habilitada

El `update` del final es grandfathering total, copia literal de `0004_users_waitlist.sql:11`. La
consecuencia hay que decirla sin adornos: **el permiso no filtra a ningún cliente actual**. Aplica
desde ese deploy hacia adelante, sobre los registros nuevos. Es la decisión tomada a sabiendas: se
prefiere no apagarle el canal a nadie que ya lo tenga andando, aunque eso signifique que el gate no
haga nada el día que se despliega.

### El permiso apaga el canal entero, no la puerta

Se comprueba **fail-closed** en las ocho superficies, y aplica también a la cuenta que ya estaba
conectada. `false` significa que Instagram deja de funcionar en el acto para ese tenant:

| dónde | qué pasa |
|---|---|
| `instagram/start` y `instagram/callback` | redirige, no se conecta |
| `instagram/send` | `403 channel_not_enabled` |
| `comments/reply` y `comments/private-reply` | `403 channel_not_enabled` |
| ingesta del webhook (DMs y comentarios) | se descarta |
| `/connections` | Instagram no se ofrece |
| `apps/api` | mismo trato en RPC, `/v1` y webhook |

La lectura es viva contra la base, nunca del JWT, por la misma razón que `readAccessRow`
(`lib/auth/waitlist.ts:32-42`): quitar o dar el permiso tiene que valer en el request siguiente sin
obligar a nadie a volver a autenticarse.

Vive en un módulo nuevo, `lib/auth/channel-access.ts`, y **no** se cuelga de `lib/auth/waitlist.ts`:
ese archivo está marcado para borrarse en cuanto se limpie el gate apagado
(`0011_disable_access_gate.sql`, comentario de cabecera), y sumarle código nuevo lo volvería
inmortal.

### El entrante de un tenant revocado se descarta

El webhook responde `200` a Meta —siempre, como hoy—, no se persiste nada, no se reenvía nada, y
queda una línea con `reason: "channel_not_enabled"`. Es el trato que ya reciben los entrantes de un
tenant sin suscripción activa (`lib/inbound/inbound-ingestion.ts:142-152`), y el mensaje de esa
persona que le escribió al negocio se pierde a propósito.

Esto solo puede ocurrir por **revocación**: como el grandfathering habilitó a todos los que existían
y el gate frena el OAuth, un tenant sin permiso no puede llegar a tener una cuenta conectada salvo
que se le haya quitado después.

### El error tiene nombre propio: `channel_not_enabled`

`403`, código nuevo en `ERROR_CODES` (`packages/contracts/src/errors.ts`), en el OpenAPI y en su
test (`apps/api/src/http/openapi.test.ts:203`). Nace **genérico y no `instagram_not_enabled`**: el
mismo bloqueo va a existir para WhatsApp y no hay que inventar un segundo código. El `message` sí
nombra el canal.

En `apps/web` las rutas con API key siguen su forma actual, `{"error": "..."}` plano; en `apps/api`
viaja en el sobre de contrato. La divergencia es preexistente y esta entrega no la toca.

### Sin permiso, Instagram no se ofrece; con cuenta conectada, se explica

Dos reglas que se leen como una: **no se ofrece lo que no se puede dar, pero no se esconde lo que ya
tenías.**

- Sin permiso y sin cuenta conectada, Instagram **no se renderiza** en `/connections`: ni el botón
  de la cabecera (`connections/page.tsx:74`) ni la tarjeta del estado vacío (`:191`). Esa tarjeta es
  justo lo que ve una cuenta nueva, que es la población que nace sin permiso.
- Sin permiso pero **con** una cuenta ya conectada (el caso de revocación), su tarjeta deja de decir
  «activa» y muestra **sin acceso**, con una línea que explica que el canal no está habilitado. Una
  tarjeta que dice «activa» sobre una cuenta que no recibe ni envía nada es exactamente el bug que
  el usuario reportaría como «no me llegan los DMs».
- El **Inbox no cambia**: el historial de Instagram ya recibido se sigue viendo, con su filtro por
  cuenta (`inbox/page.tsx:65`) y su badge de canal. No entra nada nuevo.

Ocultar el botón no es un gate: las rutas siguen comprobando el permiso por su cuenta, y quien llegue
a `/api/meta/instagram/start` con la URL a mano rebota igual.

### Aterriza en las dos apps

`apps/web` (producción hoy), `apps/api` (el worker de la migración) y `packages/contracts`. En el
worker el permiso sale casi gratis: `requireProductAccess` ya devuelve el `user` completo
(`service.ts:179-193`), así que sumar la columna a `UserRecord` y a los `select` de `getUserById`
(`repository.ts:24-30`, `:182-190`) se la entrega a los once sitios que ya lo llaman. Los puntos
propios son `connectInstagramAccount` (`service.ts:775`), las cinco rutas `/v1/comments*`
(`app.ts:268-340`, que solo existen para Instagram), el `POST /v1/messages` cuando la cuenta destino
es del canal, y la ingesta (`service.ts:1393` y `:1467`).

Se hace ahora y no cuando se migre para que el día del switch no haya un agujero esperando.

## Consequences

- **El gate no filtra a nadie el día que se despliega.** Con el grandfathering total, su efecto
  empieza con el primer registro posterior. Si hace falta cerrarle el canal a un cliente actual, es
  un `update` explícito, no una consecuencia del deploy.
- **Quitar el permiso no desuscribe la cuenta en Meta.** Los eventos van a seguir llegando para
  siempre y se van a descartar uno por uno. No es gratis —es tráfico y líneas de log— y la única
  señal de que está pasando es `reason: "channel_not_enabled"` en la bitácora.
- **Un DM o un comentario recibido durante la revocación se pierde y no vuelve.** Si después se
  devuelve el permiso, ese hueco en la conversación queda para siempre.
- **La tarjeta de Conexiones gana un tercer eje.** `status` y `token_status` ya eran independientes
  (ADR 0005); ahora hay un permiso que no es ninguno de los dos. Una cuenta puede estar activa, con
  token válido, y sin acceso.
- **No hay UI de administración, a propósito.** El permiso se opera por SQL como el gate de la 0004,
  y no hay forma de listar quién lo pidió. Si el volumen de solicitudes crece, esto se nota rápido.
- **`channel_not_enabled` es contrato público.** Agregar un código a `ERROR_CODES` es aditivo y no
  rompe a nadie, pero a partir de acá está publicado y hay que sostenerlo.
- **Cuando Meta apruebe el Advanced Access, la columna queda inerte**, igual que `waitlisted`
  después de la 0011: un `update users set instagram_enabled = true` y el gate deja de morder. La
  remoción del código muerto sería otra entrega, y ya hay una pendiente por el mismo motivo.
