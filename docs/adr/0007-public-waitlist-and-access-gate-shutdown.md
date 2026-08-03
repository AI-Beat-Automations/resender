---
status: accepted
---

# Lista de espera pública de captación, y apagado del gate de acceso

Resender opera hoy un solo canal: Messenger. Instagram (`prd_instagram.md`) y WhatsApp
(`prd_whatsapp.md`) están especificados pero no implementados, y el de Instagram además depende de
un App Review de Meta que hoy ni siquiera está pedido —el `config_id` del envío actual solo lleva
`pages_messaging`, `pages_manage_metadata` y `pages_show_list` (`CONTEXT.md`, «Configuracion de
revision Meta»).

Eso deja fuera a una parte grande de los interesados: el negocio que atiende por Instagram Direct o
por WhatsApp escucha la propuesta de valor, la entiende, y no puede comprar. Hoy esa persona se va
sin dejar rastro. Esta ADR agrega una **lista de espera de captación**: un correo electrónico que se
deja para que Resender avise cuando el canal que falta esté disponible, pensada para repartir en
conferencias y contactos cara a cara además de la landing.

No es una lista de interés por canal. La persona no elige qué espera: deja el mail y recibe los
anuncios de producto.

## El nombre estaba ocupado

`Waitlist` ya significaba otra cosa en este repo: el **gate de acceso** del lanzamiento
(`users.waitlisted`, migración `0004_users_waitlist.sql`, pantalla autenticada `/waitlist`). Ese
gate se creó para abrir el producto de a poco y aprobar cuentas a mano por SQL.

El gate sigue activo en el código, no apagado: `users.waitlisted` tiene `default true`
(`0004_users_waitlist.sql:9`) y `createUser` inserta sin esa columna (`lib/auth/users.ts:45`), así
que **toda cuenta nueva nace bloqueada**. Se aplica en seis lugares: `app/(product)/layout.tsx:25`,
`app/billing/page.tsx:29`, `app/api/meta/start/route.ts:18`, `app/api/meta/callback/route.ts:27`,
`app/api/meta/send/route.ts:53` y `features/connect-meta/actions.ts:72`.

Ya cumplió su función: el producto está en producción y el registro tiene que quedar abierto. Además
el CTA de la página nueva —«registrate ahora si ya te sirve Messenger»— sería una mentira mientras
el gate viva: llevaría a `/register`, la cuenta nacería `waitlisted = true` y volvería a la pantalla
de espera.

## Considered Options

- **Guardar los correos en un proveedor de listas** (Resend Audiences, Mailchimp) en vez de una tabla
  propia — rechazado. Resolvería gratis el envío y la baja el día del anuncio, pero mete una
  dependencia externa en el único formulario público del sitio: si el proveedor falla, el registro se
  pierde, y es justo el momento en que hay alguien esperando adelante.
- **Checkbox de canal esperado** (Instagram / WhatsApp) — rechazado. Era la propuesta inicial. Se cae
  porque el formulario de la landing quedó sin checkbox para no sumar fricción, y entonces
  convivirían dos formas del mismo registro: unos con preferencia declarada y otros sin nada. El día
  del anuncio habría que decidir si a los de la landing se les escribe igual —y la preferencia nunca
  filtró nada— o no se les escribe, incumpliendo lo prometido. Un solo aviso para todos evita el
  problema entero.
- **Sección propia debajo de los precios** — rechazado. Es la ubicación pedida originalmente, pero
  pone la salida gratis inmediatamente después del precio y antes del CTA de conversión
  (`landing-view.tsx:32-44`): al que iba a pagar se le ofrece primero una alternativa sin
  compromiso.
- **Dejar el gate vivo y publicar la página en otra URL** — rechazado. Conserva el control manual de
  acceso, pero obliga a aprobar por SQL a cada persona que llegue desde la lista y convierte el CTA
  de registro en humo.
- **Formulario solo en español** — rechazado. `LandingView` es una vista compartida por `/` y `/en`
  (`landing-view.tsx:16-18`), así que ocultarlo en inglés sería la primera excepción en un sitio
  que ya pagó el costo de ser bilingüe en diccionario, hreflang, sitemap y rutas espejo.

## Decisión

### El gate de acceso se apaga

- Migración `0011_disable_access_gate.sql`: `alter table users alter column waitlisted set default
  false` + `update users set waitlisted = false`.
- **La columna `users.waitlisted` y `lib/auth/waitlist.ts` no se borran en esta entrega.**
  `isUserWaitlisted` es fail-closed y vive en el hot path de `POST /api/meta/send`; con el default en
  `false` queda inerte. La remoción del código muerto es una entrega aparte, cuando el nuevo
  `/waitlist` esté estable.
- La pantalla autenticada `app/waitlist/page.tsx` se borra: su ruta pasa a la página pública.

### La lista vive en Postgres, no en un proveedor

Migración `0012_waitlist_signups.sql`:

```sql
create table waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null,               -- 'landing' | 'waitlist_page'
  heard_from text not null,           -- 'tiktok'|'instagram'|'x'|'youtube'|'linkedin'|'event'|'other'
  heard_from_other text null,         -- obligatorio si heard_from = 'other'
  consent_at timestamptz not null,
  consent_version text not null,
  unsubscribed_at timestamptz null,
  created_at timestamptz not null default now()
);
create unique index waitlist_signups_email_idx on waitlist_signups (lower(email));
```

- `source` registra **la ruta** donde se completó el formulario, no una campaña. No se lee ningún
  `?ref=`: no se puede distinguir un evento de otro, solo landing de página.
- `heard_from` guarda **claves, nunca etiquetas traducidas**. Si guardara el label, el mismo canal
  entraría dos veces según el idioma y el `group by` dejaría de servir.
- La salida de la lista es un script (`npm run waitlist:export` → CSV). Sin él, los correos solo se
  pueden sacar abriendo la consola de Neon, y una lista que no se puede extraer no sirve.

### El formulario pide dos cosas

Correo electrónico y **cómo conoció Resender** (`tiktok`, `instagram`, `x`, `youtube`, `linkedin`,
`event`, `other`). Selección **única y obligatoria**; con `other`, el texto libre también es
obligatorio, con tope de ~120 caracteres. Selección única para que el reparto por canal se lea
directo con un `group by`, sin que 40 registros sumen 90 marcas.

### El consentimiento es explícito y queda registrado

- Checkbox **bloqueante**: sin marcarlo no se envía. Una fila sin consentimiento sería una fila a la
  que no se le puede escribir.
- Se guardan `consent_at` y `consent_version` (`'2026-08'`). El día que cambie la redacción del
  aviso, se sabe qué aceptó cada persona sin arqueología de commits.
- Aviso bajo el formulario y bloque **Waitlist data** nuevo en `/privacy`. La política declara hoy
  solo dos categorías —*Account data* y *Messenger end-user data*
  (`app/privacy/page.tsx:63-88`)— y dice «We use this data only to operate the service»
  (`app/privacy/page.tsx:91`); un correo de alguien que no es cliente, guardado para mandarle un
  anuncio, no entra en ninguna de las dos. `resender.dev/privacy` es además el artefacto cargado en
  el panel de Meta.
- `unsubscribed_at` se crea desde el inicio aunque todavía no exista canal de correo: se promete
  baja, y agregarla ahora evita una migración cuando el canal exista.

### El formulario público es la primera escritura anónima del repo

Todo lo demás escribe detrás de sesión, API key opaca o firma HMAC. Protección en tres capas:

- Validación de formato de correo y campo trampa (honeypot) oculto.
- `unique index` sobre `lower(email)`.
- Rate limit por IP con el binding nativo `ratelimits` de Cloudflare en el worker de `web`, mismo
  patrón que ya corre en `apps/api` (`apps/api/wrangler.jsonc:43`, aplicado en
  `apps/api/src/http/app.ts:309`).

Se descartó Cloudflare Turnstile por ahora: suma un paso que puede fallarle a un usuario real justo
cuando está delante en un evento. Se agrega si aparece basura real.

### Un correo repetido es un éxito idempotente

No se inserta nada y la persona ve el mismo mensaje que la primera vez. No se revela si un correo
está en la lista, y **la atribución del primer registro queda intacta** (first-touch): un segundo
envío no pisa `source` ni `heard_from`.

### Dónde aparece

- **Landing (`/` y `/en`)**: el formulario **no** va como sección propia debajo de los precios. Se
  fusiona en el cierre existente (`FinalCta`), con «Empieza» como acción primaria y el formulario
  como camino secundario. Un solo momento de decisión.
- **`/waitlist` y `/en/waitlist`**: página pública con una explicación breve de qué es Resender, el
  formulario, y un CTA de registro para quien ya le sirve Messenger hoy. Es el enlace para repartir
  en conferencias.
- Ambas leen su copy del diccionario (`content/i18n/es.ts` y `en.ts`), incluidas las siete etiquetas
  de `heard_from` y el texto de consentimiento.
- `/waitlist` sale de `PRIVATE_PATHS` en `app/robots.ts:15` y entra al sitemap con sus `alternates`.

## Consequences

- **Stripe queda como única barrera de entrada.** Apagado el gate, cualquiera se registra y el único
  filtro es la suscripción activa (`CONTEXT.md`, «Gate de suscripcion»). Ya no hay forma de frenar a
  una cuenta sin tocar la base.
- **La lista no se puede accionar todavía.** No hay proveedor de correo en el repo, así que el día
  que Instagram salga hay que resolver el envío antes de poder avisar. El script de export es lo
  único que garantiza que los datos salgan de ahí mientras tanto. La promesa de baja además exige un
  enlace real cuando ese canal exista; la columna ya está.
- **El `heard_from` obligatorio cuesta registros.** Es un campo más en un formulario cuyo único
  activo es el correo. Es una decisión consciente: el dato de atribución se consideró más valioso
  que los envíos que se pierdan. Si el ratio de abandono se nota, el arreglo es volverlo opcional,
  no sacarlo.
- **Sin `?ref=` no hay atribución por evento.** `heard_from = 'event'` dice que vino de un evento
  presencial, nunca de cuál. Recuperarlo después no es retroactivo: el dato o se captura en el
  `insert` o se perdió.
- **La lista de pantallas «español hardcoded» baja de siete a seis.** La ADR 0005 y la
  [ADR 0006](0006-access-screens-return-to-the-dictionary.md) enumeran `/waitlist` entre las
  pantallas de producto con español en el JSX. Esa `/waitlist` deja de existir; la nueva es pública,
  la ve alguien sin sesión y por lo tanto cae del lado del diccionario, según el criterio que fijó la
  propia 0006.
- **Enumeración descartada por diseño.** Con el éxito idempotente nadie puede averiguar si un correo
  ajeno está en la lista, a costa de que quien se anota dos veces nunca se entere.
- **Queda una inconsistencia adyacente sin resolver**: el CTA final dice «Sin tarjeta para arrancar»
  (`content/i18n/es.ts:159`) y `CONTEXT.md` («Sin trial») dice que para usar el producto hay que
  pagar. No es de esta entrega, pero está en la sección que esta entrega modifica.
