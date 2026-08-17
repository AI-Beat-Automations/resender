---
status: accepted
---

# Cupo por conexión e Instagram dentro de facturación

El cupo del plan cuenta **solo páginas de Facebook**. El filtro está escrito dos veces, una por app, y
en las dos con un comentario que lo declara intencional: `apps/web/lib/pages/page-registry.ts:161-172`
y `apps/api/src/infrastructure/db/repository.ts:344-357`, ambos con `and channel = 'messenger'` dentro
de la consulta. Ese número es el que alimenta a la vez el entitlement ([ADR 0003]) y la pantalla de
selección, así que una cuenta de Instagram conectada es invisible en los tres lugares donde el cupo se
muestra: el badge de `/connections` (`connections/page.tsx:241`), el `1 / 2` de Ajustes
(`settings/page.tsx:137`) y la pantalla de selección (`connections/select/page.tsx:109`).

El reporte que abrió esta ADR es exactamente eso: una cuenta Starter con una Página de Facebook y una
cuenta de Instagram conectadas, ambas activas y recibiendo, y el contador diciendo «1 de 2 páginas de
Facebook».

Hay un segundo agujero que el primero tapaba: **conectar Instagram no valida cupo en ninguna parte**.
Messenger lo valida antes de persistir (`apps/api/src/application/service.ts:992-997`), pero
`connectInstagramAccount` (`service.ts:790`) y el callback de web
(`app/api/meta/instagram/callback/route.ts:156`) conectan directo. Mientras Instagram no ocupaba cupo
eso era coherente; en el momento en que ocupa, es la puerta por donde se rompe el invariante.

El modelo de negocio es por **recurso conectado**, sin importar el canal. Ni el código ni el
diccionario lo dicen así hoy.

## Considered Options

- **Un negocio = un slot, con sus N canales** (la Página de Facebook y la cuenta de Instagram del
  mismo negocio comparten cupo) — rechazada. Es lo que el cliente intuye —«es mi negocio, es una
  cosa»— y abarataría el plan sin cambiar el precio. Se cae por lo que exige: una vinculación
  explícita entre canales que hoy no existe en `connected_pages`, más una respuesta para el caso que
  no es raro sino el común —una cuenta de Instagram conectada **sin** su Página de Facebook—, y otra
  para qué pasa cuando el usuario conecta la Página después. Modelar un agrupador para poder cobrar
  menos por el mismo trabajo de infraestructura.
- **Un cupo por canal** (N de Messenger, N de Instagram, N de WhatsApp) — rechazada. Es lo más
  parecido a lo que hay hoy y se lee bien en la tabla de precios. Multiplica el techo real sin
  quererlo: Starter pasaría de 2 recursos a 6 en cuanto WhatsApp exista, y cada canal nuevo obliga a
  tocar el mapa de planes, el copy publicado y los precios de Stripe. Un solo número no tiene esa
  deriva.
- **Suspender automáticamente las conexiones excedentes** tras un downgrade, dejando activas las más
  antiguas — rechazada. Mantiene el servicio vivo y es predecible, pero exige un estado nuevo
  (`suspended_by_plan`) que se suma a `status` y `token_status`, que ya son dos ejes independientes
  ([ADR 0005]) más el permiso de canal de la [ADR 0010]. Y elige por el cliente cuál de sus negocios
  deja de responder, que es justo la decisión que no queremos tomar nosotros.
- **Rechazar el downgrade mientras haya más conexiones que el plan destino** — rechazada. Volvería el
  invariante `activas ≤ maxConnections` verdadero de verdad y permitiría borrar
  `entitlements.ts:128-137` entero. Se cae porque el downgrade es diferido al cierre del período
  ([Cambio de plan]) y se opera desde el Customer Portal de Stripe: bloquearlo de verdad significa
  interceptar el webhook y decirle a Stripe que no, semanas después de que el usuario lo pidió, o
  poner un gate propio delante del portal y quedarnos con la mitad de los caminos cubiertos.
- **Llamar Canal (`Channel`) a lo que ocupa un slot** — rechazada. `connected_pages.channel` ya existe
  y significa el **tipo** (`messenger` | `instagram`), no la instancia (`0013_instagram_channel.sql`).
  Un nombre con dos sentidos en la misma tabla es la clase de ambigüedad que la [ADR 0010] ya pagó
  cara con `waitlist`.
- **Llamarlo Cuenta conectada (`ConnectedAccount`)** — rechazada por la misma razón, con otra
  colisión: «cuenta» ya significa la cuenta **de Resender** —el [Tenant], `Ajustes > Cuenta`, el
  [Borrado de cuenta]— y [Cuenta restringida] es un estado del tenant, no de una conexión. El
  diccionario ya usa «cuenta conectada» (`CONTEXT.md:74`) para la fila, y ese solapamiento es
  precisamente lo que conviene dejar de alimentar.
- **Renombrar todo el vocabulario a `Connection`**: tabla `connected_pages → connections`, `maxPages →
  maxConnections`, `page_limit_exceeded → connection_limit_exceeded`, `/v1/pages → /v1/connections`
  — rechazada **por ahora**. Sin nadie en producción es el momento más barato que va a existir, y aun
  así son ~40 archivos, una migración y el OpenAPI. Se prefiere entregar la regla correcta primero.
  Queda como deuda declarada más abajo.
- **Instagram ocupa cupo pero sus mensajes siguen sin contar** — rechazada. Habría dejado
  [Instagram fuera de facturacion] partido en dos mitades que se contradicen, y un tenant restringido
  seguiría recibiendo por Instagram: indistinguible de un bug para quien lo mira desde afuera.
- **Los comentarios de Instagram fuera de la cuota** (solo DMs cuentan) — rechazada. Protegería al
  cliente del post viral que quema el mes, pero los comentarios son la superficie más cara de operar
  —webhooks constantes, tabla propia— y serían la única gratis del sistema.

## Decisión

### El cupo cuenta conexiones activas, sin mirar el canal

La regla completa es una consulta sin ramas:

```sql
select count(*) from connected_pages
where tenant_id = $1 and status = 'active'
```

Se borra `and channel = 'messenger'` de las dos implementaciones (`page-registry.ts:167`,
`repository.ts:353`) y se invierten los comentarios de cabecera, que hoy declaran lo contrario como
intencional. Lo que **no** cambia: desconectar sigue siendo un `UPDATE` y una conexión desconectada
sigue sin ocupar cupo.

Una Página de Facebook y una cuenta de Instagram del mismo negocio son **dos** conexiones y ocupan
**dos** slots. Es la regla más simple de contar, de explicar en el pricing y de sostener cuando entre
WhatsApp: un número de WhatsApp será una conexión más.

### Conectar Instagram valida cupo, lo antes que la identidad permite

Se agrega el chequeo que Messenger ya tiene, en los dos caminos —`service.ts:790` y
`app/api/meta/instagram/callback/route.ts:156`—. Rebota con `403 page_limit_exceeded`, el código que
ya existe.

El chequeo queda **partido en dos mitades**, y conviene decir por qué. La intención era hacerlo entero
antes del intercambio de OAuth, por el mismo motivo que el permiso de canal de la [ADR 0010]: el
`code` se quema al usarlo una vez. Pero la request de Instagram trae un `code` y nada más —el IG id
de la cuenta recién lo devuelve `getProfile`, después del intercambio—, y sin saber **qué** cuenta es
no se puede distinguir una conexión nueva de una reconexión. Rebotar antes con
`activePageCount >= maxPages` rompería a quien está en el tope y solo quiere reconectar lo que ya
tiene, que es el caso 7 del issue.

Así que: **antes** del intercambio se resuelve el plan y se rebota si no se puede resolver, que es
independiente de qué cuenta sea; y se recuerda si el tenant está en el tope. **Después** de
`getProfile`, y solo si estaba en el tope, se mira si esa cuenta ya está `active` para este tenant: si
lo está pasa —es reconexión y ya ocupaba su slot—, y si no, rebota. El costo asumido es un `code`
quemado en el único caso que igual iba a rebotar: el que está al tope y conecta una cuenta nueva.

Si la cuenta ya es de **otro** tenant, gana el error de propiedad de la [ADR 0004] y no el de cupo:
decirle "liberá un slot" a quien intenta conectar una cuenta ajena lo manda a desconectar conexiones
para nada.

Reconectar una cuenta ya activa del mismo tenant no consume slot nuevo: es la misma regla idempotente
que [Reconexión de páginas].

### El estado excedido se mantiene tal como está

`activePageCount > maxPages` sigue produciendo el bloqueo de `entitlements.ts:128-137`: entrantes
persistidos, sin reenvío al webhook, envío bloqueado para **todas** las conexiones del tenant. No
desconectamos nada por nuestra cuenta; lo levanta el usuario desconectando.

Con la validación al conectar, la única vía de entrada a ese estado es un downgrade de plan. Se
acepta a sabiendas que un tenant puede quedar apagado por completo hasta que decida qué suelta, y que
lo único que lo avisa es la barra de la [Aviso de cuota] y el copy de `quota-notice-bar.tsx:29-31`.

### Instagram entra a facturación, completo

Se borra la excepción [Instagram fuera de facturacion]. Un canal conectado es un canal conectado:

- `CHANNEL_IS_METERED` (`lib/inbound/inbound-ingestion.ts:66-69`) pasa a ser `true` en los dos canales.
  Con eso el entitlement se resuelve también para Instagram y desaparece la rama `entitlement === null`
  de `:210-216` y `:321-324`.
- Los tres `// Sin incrementUsage: Instagram no consume cuota` se convierten en llamadas reales:
  `instagram/send/route.ts:329`, `instagram/comments/reply/route.ts:195`,
  `instagram/comments/private-reply/route.ts:237`, más `service.ts:707` en el worker.
- [Cuenta restringida] corta Instagram igual que Messenger.

Los **comentarios** cuentan con la misma regla que un DM y sin excepción: un comentario entrante
persistido suma 1, una respuesta que Meta acepta suma 1. `countsTowardQuota`
(`lib/billing/entitlements.ts:230-234`) no necesita cambiar —ya está escrita por `kind` y no por
canal—; lo que cambia es que ahora se la llama desde las rutas de Instagram.

La consecuencia comercial hay que decirla sin adornos: **un post con muchos comentarios puede quemar
la cuota de un mes**, y el negocio no eligió recibirlos. Se acepta porque los comentarios son la
superficie más cara de operar y porque una regla con asteriscos por canal es la que produjo este bug.

### El vocabulario se arregla solo donde se ve

El alcance de esta entrega es **la regla y el copy visible**. Los nombres internos —`connected_pages`,
`maxPages`, `pageLimit`, `activePageCount`, `countActivePages`, `page_limit_exceeded`, `/v1/pages`—
se quedan como están.

En pantalla, «páginas de Facebook» pasa a ser «conexiones»:

| dónde | hoy | queda |
|---|---|---|
| `connections/page.tsx:241` | `N de M páginas de Facebook` | `N de M conexiones` |
| `subscription-panel.tsx:97` | `páginas  1 / 2` | `conexiones  1 / 2` |
| `connections/select/page.tsx:109` | `N de M páginas conectadas` | `N de M conexiones` |
| `quota-notice-bar.tsx:30` | `permite M páginas conectadas` | `permite M conexiones` |
| `page-selection.ts:130` | `permite M páginas conectadas` | `permite M conexiones` |
| `page-selection-form.tsx:131` | `que te permite tu plan` | idem, sin «páginas» |
| `billing/page.tsx:97-98` | `M página/páginas` | `M conexión/conexiones` |
| `content/i18n/es.ts:185,199,500,524` | `2 páginas de Facebook` | `2 conexiones` |

El copy de marketing (`es.ts:127,169,500,524`) además deja de prometer que Resender «funciona con
páginas de Facebook»: hoy son dos canales y mañana tres.

## Consequences

- **El contador sube para todo el que tenga Instagram conectado.** La cuenta del reporte pasa de `1 / 2`
  a `2 / 2`: correcto, y al tope. No hay grandfathering ni migración de datos porque no hay nadie en
  producción; esa es la única razón por la que este cambio es barato hoy y no lo sería en tres meses.
- **Instagram deja de ser gratis.** Los mismos tenants que hoy no ven consumo por Instagram van a
  verlo, y pueden quedar [Cuenta restringida] por tráfico que antes era invisible. Es un cambio de
  precio efectivo sin cambio de precio nominal.
- **Un post viral puede agotar la cuota del mes.** Sin tope por conexión ni por tipo de evento, un pico
  de comentarios consume unidades a la velocidad a la que Meta las manda. No hay mitigación en esta
  entrega; si se vuelve un problema real, la respuesta natural es un límite por conexión, que es otra
  ADR.
- **El código sigue diciendo «page» donde significa «conexión».** `maxPages` ya no son páginas y
  `page_limit_exceeded` ya no es de páginas. Es deuda declarada, no descuido: el próximo que lea
  `countActivePages` va a suponer Páginas de Facebook, que es exactamente el error que esta ADR cierra.
  El rename a `Connection` queda pendiente y se abarata mientras no haya clientes.
- **`page_limit_exceeded` es contrato público y se queda con el nombre viejo.** El `message` sí se
  reescribe para hablar de conexiones, así que el código y su texto no coinciden. Renombrarlo es
  aditivo pero obliga a mover el OpenAPI y sus tests, y entra en la misma entrega que el rename.
- **La consulta duplicada sigue duplicada.** El mismo `count` vive en `apps/web` y en `apps/api`, y
  esta entrega toca los dos. Mientras la migración a worker no termine, cualquier regla de cupo hay
  que escribirla dos veces y se puede olvidar una.
- **Desaparece la razón por la que Instagram no resolvía entitlement.** Medir Instagram agrega una
  lectura de entitlement por tenant en la ingesta de ese canal —memoizada por payload
  (`inbound-ingestion.ts:143-144`), como Messenger—. Es tráfico nuevo contra la base en la ruta
  caliente del webhook.

[ADR 0003]: 0003-plan-entitlements-usage-quota.md
[ADR 0004]: 0004-page-selection-and-per-page-ownership.md
[ADR 0005]: 0005-console-redesign-v2-scope-shell-tokens-and-language.md
[ADR 0010]: 0010-permiso-de-instagram-por-cuenta.md
