---
status: accepted
---

# Rediseño de la consola v2: alcance recortado, shell con sidebar, tokens del DS e idioma

> **Enmendada en tokens, shell y alcance por la
> [ADR 0015](0015-ui-neutra-violeta-shadcn.md):** paleta neutra + violeta, shell sobre el bloque
> `Sidebar` de shadcn y alcance que incluye el sitio público. Lo demás sigue vigente.

> **Enmendada en el punto del idioma por la
> [ADR 0006](0006-access-screens-return-to-the-dictionary.md):** `/login` y `/register` leen su
> texto del `Dict` porque tienen gemela en `/en`. Las otras siete rutas de producto siguen con el
> español hardcoded que decide este documento.

El rediseño parte de `Dashboard Resender v2.dc.html`, en el proyecto de diseño
`claude.ai/design/p/f08ad4ae-6933-48f4-a750-b56f6946127b`, junto a `App Sidebar.dc.html` y el
design system `resender-dev-design-system-52f374d5-…`. **v2 no es una revisión de la versión
anterior: es su reemplazo.** El diseño de 21 pantallas con `/overview`, `/deliveries`,
`/webhooks`, `/api-keys` y `/onboarding` queda archivado, y con él se borraron las dos ADR que lo
documentaban y el glosario que nombraba sus pantallas.

La premisa de v2 es «lo mismo, mejor puesto»: las mismas pantallas y los mismos datos que hoy
devuelve el código, reordenados en un shell con sidebar, en español, con los estados que ya
existen resueltos visualmente. **Sin métricas, sin gráficos, sin log de entregas, sin probador de
webhooks, sin onboarding.**

El alcance es **desde `/login` hacia adentro**: `app/(auth)/*`, `app/waitlist`, `app/billing/*` y
`app/(product)/*` — **nueve rutas de producto**. Queda fuera todo lo público: `app/page.tsx`,
`blog`, `docs`, `pricing`, `privacy`, `terms`, `data-deletion` y los `components/site-*`.

v2 dibuja doce pantallas sobre ocho rutas. **La novena, `/connections/select`, no está dibujada**
y entra igualmente en el alcance (ver más abajo).

## Considered Options

**Tokens del design system** — `_ds/tokens/*` redefine `:root`. Ese `:root` vive en
`packages/ui/src/styles/globals.css`, que `app/layout.tsx:4` importa para **toda** la web.

- **Aislar los tokens del producto bajo un selector propio** — rechazado. Deja el landing
  byte-idéntico por construcción, a cambio de dos capas de tokens y de decidir a qué capa
  pertenece cada componente de `packages/ui`.
- **Añadir solo los tokens nuevos sin tocar valores existentes** — rechazado. Tampoco mueve el
  landing, pero condena código y diseño a divergir token por token cada vez que el DS evolucione.
- **Adoptar los siete archivos del DS tal cual** — elegido. Una sola fuente de verdad, con el
  coste explícito de las tres reconciliaciones que documenta la sección de consecuencias.

**El nombre del contacto en Mensajes** — `conversations.contact_name` existe en el esquema
(`db/migrations/0001_mvp_foundation.sql:32`) y se lee en el read model, pero **nunca se escribe**:
el `insert` de `lib/messages/message-log.ts:63` solo mete `tenant_id`, `connected_page_id`,
`contact_id` y `last_message_at`. `formatContactLabel` devuelve siempre `PSID <id>`. v2 dibuja la
lista con nombres propios y una sola fila con PSID, o sea al revés de la realidad.

- **Traerlo del Graph API de Meta en la ingesta** — rechazado. Una llamada extra en el hot path de
  entrada y, sobre todo, dato personal nuevo en la base, con lo que arrastra de RGPD, política de
  privacidad y `/data-deletion`. Deja de ser un cambio de diseño.
- **Alias editable por el tenant** — rechazado. Escribe en la columna que ya existe sin pedirle
  nada a Meta, pero es una función nueva con su formulario, su acción y su estado.
- **Aceptar el PSID y rediseñar la pantalla en consecuencia** — elegido.

**Migración a FSD** — `handoff_fsd.md` describe el plan completo; `apps/web/src/` no existe y el
alias sigue siendo `@/*` → `./*`. No se ha empezado nada.

- **Dentro de esta tanda, como primer PR** — rechazado. Es el momento de menor coste marginal,
  pero concentra el riesgo en un PR que reescribe los imports de toda la app justo cuando el
  rediseño va a tocar casi todos esos archivos.
- **Archivarla** — rechazado. Sería la respuesta honesta si no fuera a pasar, pero sí va a pasar.
- **Después del rediseño, en su propia rama** — elegido. El rediseño avanza sin bloqueo y la
  migración se hace sobre código ya en español y ya con el shell nuevo.

## Decisiones de dominio (fijadas en la entrevista)

- **Nueve rutas de producto**, no ocho: `/login`, `/register`, `/waitlist`, `/billing`,
  `/billing/success`, `/connections`, `/connections/select`, `/messages`, `/settings`.
- **`/connections/select` se rediseña y sigue siendo ruta**, no diálogo. Hace una llamada de red a
  Meta al abrirse (`listAuthorizedPages`) que puede fallar y hoy se resuelve con un `redirect()`;
  un diálogo que tumba la pantalla de debajo es peor experiencia, y obligaría a reescribir el
  camino de error. Tiene cuatro estados propios (sin user token, plan sin resolver _fail-closed_,
  lista clasificada, errores de validación) y hay que dibujarlos: **v2 está incompleto en este
  punto**.
- **Planes: dos, Starter y Pro.** El Business de $60 que pintaba v2 no existe en
  `lib/billing/plans.ts` ni en el `/pricing` público, y no se reintroduce.
- **A4 lista los límites de cada plan** («50.000 mensajes · 2 páginas»), como ya hace `/pricing`.
  Hoy `/billing` es la única superficie donde el usuario paga sin poder ver qué compra, y el dato
  ya está en `PLANS.limits`.
- **Tokens: los siete archivos del DS**, en `packages/ui/src/styles/globals.css`. El delta
  cromático real sobre el landing es **un solo color** —`#f3ece0` → `#F3EDE1`, un punto de 255 en
  verde y otro en azul—: todo lo demás que ya existía es byte-idéntico. `semantic.css` aporta
  además `--destructive-foreground`, que hoy no está definido.
- **Idioma: tuteo neutro en el producto.** El landing está en voseo rioplatense
  (`content/i18n/es.ts`) y no se toca, así que **los dos registros conviven a propósito**:
  marketing con voz, herramienta neutra. No es un descuido y no hay que «arreglar» ninguna mitad.
- **Español hardcoded en el JSX, sin `dict` ni i18n** para el dashboard. Los mensajes de error del
  servidor se traducen donde ya viven (`lib/`, `features/*/actions.ts`), sin capa nueva.
- **Shell: sidebar fijo de 240 px** en lugar del header sticky de `app/(product)/layout.tsx`, con
  cuatro items planos y sin grupos: Conexiones (`link-2`), Mensajes (`inbox`), Ajustes
  (`settings`) y Documentación (`book-open`, con indicador de externo). Al pie, interruptor de
  tema y bloque de identidad: iniciales, email y cerrar sesión.
- **`QuotaNoticeBar` se queda**, como franja horizontal arriba del contenido, al ancho del `main`.
  v2 no la dibujaba, pero existe (`app/(product)/layout.tsx:69`), tiene dos estados (`warning` y
  `restricted`, este último explicando por qué el producto dejó de funcionar) y **el FAQ público
  la promete**: «desde el 80% de tu cuota te aparece una barra de aviso en el dashboard»
  (`content/i18n/es.ts:151`).
- **Consumo en Ajustes → Suscripción: barra de progreso solo en mensajes**, páginas como contador
  `2 / 5`. Una barra para «2 de 5» es ruido. Usa **los mismos umbrales que la barra global**
  (neutra, ámbar ≥80%, destructiva al bloquear): dos componentes, un solo criterio.
- **Sin límite resuelto no hay barra.** `messageLimit: null` no significa «sin límite», significa
  que el plan no se pudo resolver y `resolvePlanLimits` lo trata como _fail-closed_. Una barra
  vacía sugeriría cuota libre; va el estado de bloqueo explícito con el contacto de soporte.
- **Ajustes en tres pestañas con el estado en la URL** (`/settings?tab=…`, `cuenta` por defecto).
  No es purismo: `quota-notice-bar.tsx:45` manda a `/settings` con el texto «Upgrade plan» y con
  estado en React aterrizaría en Cuenta, mostrándole a un usuario bloqueado su email y un botón de
  borrar cuenta.
- **Entran «Reconectar» y «Volver a conectar»**, que v2 dibuja y el código no tiene. No son
  funciones nuevas: son atajos a caminos que ya existen —`/api/meta/start` para re-autorizar, y
  `/connections/select` para la desconectada, que `page-selection.ts:75` ya devuelve como
  `selectable`. Corrigen un defecto real: hoy la tarjeta de token inválido **dice** «reconéctala
  desde Facebook» y no da con qué; el botón está arriba, en otra sección, sin relación visual con
  el error.
- **El cupo se muestra en Conexiones** (`2 de 5 páginas`, en la cabecera de la lista) en lugar de
  deshabilitar botones. Un control inerte y mudo es la peor salida, y el dato no cuesta una query
  nueva: el layout ya resuelve `getTenantEntitlement` para la barra de aviso. **Es lo único que
  rompe el «nada nuevo» de v2**, y se acepta.
- **Mensajes muestra siempre el PSID y se dibuja como log, no como bandeja de entrada.** Sin
  avatar de iniciales, PSID en mono como identificador secundario, y el último mensaje en el
  renglón principal, que es lo único que ayuda a reconocer una conversación. El avatar del sidebar
  **sí** lleva iniciales: ahí el dato existe (es el email del propio usuario).
- **Los cinco errores de Meta, no tres.** v2 ilustra `webhook_subscription_failed`, `page_owned:` y
  `state_mismatch`; `formatMetaConnectionError` también devuelve `configuration_failed` y
  `meta_session_expired`.
- **`/connections` sigue siendo el destino post-login** (`features/auth/actions.ts:32` y `:77`).
  Como `/overview` desapareció, no se toca.
- **Cambios de componente que el diseño exige:** los `window.confirm` de desconectar / revocar /
  eliminar pasan a diálogo; las pills `bg-green-100` pasan a `Badge` con variantes success /
  warning / destructive / ghost; las burbujas del log usan `--bubble-in` y `--bubble-out`.
- **Corrección de copy obligatoria:** `/connections/select` dice, sin cupo, «disconnect a Page in
  Connections to add another one». Si llegaste desde «Volver a conectar», eso te devuelve de donde
  vienes. En español tiene que nombrar la acción, no la pantalla.
- **Definición de terminada: vitest para la lógica nueva + revisión visual manual.** Sin Playwright
  ni seeds.

## Vocabulario

Nombre en la UI (español, tuteo) y su identificador en el código.

| UI                  | Código                                | Definición                                                                           |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| Cuenta              | `users.id`, `tenant_id`               | Un usuario **es** un tenant: no hay organizaciones ni miembros.                      |
| Lista de espera     | `users.waitlisted`                    | Cuenta creada sin acceso al producto; el gate de `(product)` la manda a `/waitlist`. |
| Plan                | `PLAN_LOOKUP_KEYS`                    | Suscripción mensual de Stripe. Son **dos**: `starter_monthly` y `pro_monthly`.       |
| Cuota               | `TenantEntitlement.messagesPerPeriod` | Mensajes del ciclo, contando ambas direcciones.                                      |
| Límite de páginas   | `maxPages`                            | Cuenta solo páginas `active`; las desconectadas no ocupan cupo.                      |
| Conexión / página   | `connected_pages`                     | Página de Facebook autorizada por un tenant. Pertenece a **un solo** tenant.         |
| Página activa       | `status='active'`                     | Recibe tráfico y ocupa cupo.                                                         |
| Página desconectada | `status='disconnected'`               | No recibe tráfico; conserva el historial (desconectar es `UPDATE`, no `DELETE`).     |
| Token inválido      | `token_status='invalid'`              | Meta rechazó el page token. Eje **independiente** de `status`.                       |
| Webhook             | `connected_pages.webhook_url`         | URL del tenant, por página, a la que se reenvía cada entrante. https obligatorio.    |
| Conversación        | `conversations`                       | Hilo entre una página y un contacto, ordenado por `last_message_at`.                 |
| Contacto            | `contact_id` (PSID)                   | Identificador que da Meta, con ámbito de página. Se muestra **siempre como PSID**.   |
| Entrante            | `direction='inbound'`                 | Mensaje que Meta nos envía y persistimos.                                            |
| Respuesta           | `direction='outbound'`                | Mensaje que el tenant manda por la API de Resender. `status='sent'` o `'failed'`.    |
| API key             | `api_keys`                            | Credencial opaca para la API externa. El secreto se muestra una sola vez.            |

## Consequences

- **v2 está incompleto**: falta dibujar `/connections/select` con sus cuatro estados. Cualquiera
  que use el `.dc.html` como inventario de pantallas se va a saltar una ruta real.
- **`typography.css` obliga a tres reconciliaciones**, y una no es opcional: declara
  `--font-heading:"HK Grotesk Pro"…` **y** `--font-hk: var(--font-heading)`, mientras
  `globals.css:13` declara `--font-heading: var(--font-hk, var(--font-sans))`. Juntas forman una
  referencia cíclica, inválida en tiempo de cómputo, que tumbaría los títulos en **todo el sitio**.
  Una de las dos líneas tiene que ceder; se conserva la fuente auto-hospedada por `next/font`.
  Además hay que repuntar los `src` de los `@font-face` a `apps/web/app/fonts/` (los del DS apuntan
  a rutas que no existen en el repo), y el `@import` de Google Fonts añade una petición externa
  bloqueante que duplica Inter y Space Mono, que `next/font/google` ya auto-hospeda.
- **`base.css` estiliza elementos desnudos** (`body`, `h1`–`h4`, `a`, `p`, `code`, `::selection`,
  `:focus-visible`) y choca con el preflight de Tailwind y con el `prose` de
  `@tailwindcss/typography` del blog. Es el punto donde el «no tocar el landing y el blog» tiene
  más probabilidades de romperse.
- **Dos registros de español conviven** en el mismo dominio. Un usuario cruza de voseo a tuteo
  entre `/pricing` y `/register`.
- **Español hardcoded implica que un inglés futuro reabre las nueve pantallas**, mientras la mitad
  pública del sitio ya está preparada para clonarse a `en.ts`.
- **FSD aplazado significa tocar parte del código dos veces**: primero para rediseñarlo, después
  para moverlo de sitio.
- **Mensajes es un log, no una bandeja de entrada.** Si el producto crece hacia lo segundo, hay que
  reabrir la decisión del nombre del contacto, y esa reapertura es una llamada al Graph API en el
  hot path más dato personal nuevo en la base.
- **Sin e2e, la revisión manual es el único filtro de fidelidad** sobre nueve pantallas.
