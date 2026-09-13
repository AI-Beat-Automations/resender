# Modo agencia: estado del trabajo

Última actualización: 2026-09-13. Decisión de arquitectura en
[ADR 0020](adr/0020-modo-agencia-clientes-y-acceso-acotado.md) (todavía `proposed`).

## Para qué es

Quien arma el bot (Juan, la **agencia**) lo hace para un negocio (Pedro, el **cliente**), y las
cuentas de Meta que hay que conectar son las de Pedro. Antes de esto había dos salidas malas: Juan
le pedía a Pedro las credenciales de Instagram o Facebook, o Pedro abría su propia cuenta de
Resender y la pagaba.

Con el modo agencia:

- **Juan es el dueño de la cuenta.** Paga, tiene las API keys y los webhooks, y ve todo.
- **Dentro de su cuenta crea un _cliente de agencia_ por cada negocio** y le da acceso a una
  persona.
- **Pedro entra con acceso acotado.** Conecta y desconecta **sus** cuentas y ve **su** Inbox. No ve
  nada de otros clientes, ni el webhook, ni las API keys, ni la facturación.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Aislamiento | Cada cliente ve solo lo suyo. Una persona por cliente en v1; el esquema admite más. |
| Invitación | Enlace copiable (hecho) y correo desde Resender (pendiente, PR 4). |
| Dónde se administra | Todo en **Conexiones**, sin sección nueva en el menú. Se agrupa por cliente, con un grupo "Sin asignar". |
| Flujo habitual | Juan crea el cliente e invita a Pedro. Pedro conecta sus cuentas, que quedan asignadas solas a su cliente. |
| Conexión que ya existía | Juan la asigna a un cliente desde "Sin asignar". El cliente ve también su historial. |
| Canales del cliente | Todos los que la cuenta de Juan tenga habilitados. |
| Quitar acceso | Borra el usuario de Pedro. Queda afuera en su siguiente request. |
| Conexión sin asignar | Pedro **no puede tomarla** aunque la administre en Meta. La asigna Juan. |
| PIN de WhatsApp | Es el PIN de verificación en dos pasos del número, no del bot. Lo ven Juan y Pedro. |
| Quién puede aceptar | Una persona es dueña de su cuenta **o** miembro de un solo cliente. Una cuenta con suscripción, conexiones, clientes o API keys propias no puede aceptar. |
| Correo en la invitación | Si Juan lo escribe, tiene que coincidir con la cuenta que acepta. No hace falta tenerlo verificado. |
| Plugin `organization` de Better Auth | Descartado. Expone endpoints y `authClient`, y guarda la organización activa en la sesión, cuya caché dura 5 minutos. |
| Entornos | Todo se prueba en **staging**. Nada llega a producción sin verificarlo ahí. |

## Cómo funciona por dentro

- **Tenant.** Sigue siendo `users.id` del dueño.
  - `agency_clients`: los clientes de agencia de cada tenant.
  - `agency_client_members`: la persona de cada cliente, con su propia fila de `users`.
  - `agency_client_invitations`: las invitaciones. Solo guarda el hash del token.
  - `connected_pages.agency_client_id`: a qué cliente está asignada cada conexión.
  - Las foreign keys son compuestas con `tenant_id`, así que la base impide cruzar tenants.
- **Actor** (`lib/auth/actor.ts`). Define quién opera: `owner` o `client`. Se lee de la base en cada
  request y **nunca se guarda en la sesión**. El gate de acceso mira a la persona; la suscripción y
  los permisos de canal miran al tenant.
- **Alcance** (`lib/pages/connection-scope.ts`). El dueño ve todo el tenant; el cliente, solo las
  conexiones asignadas a su cliente. Se aplica en:
  - el registro de conexiones;
  - el Inbox (mensajes y comentarios);
  - los medios de WhatsApp;
  - la selección de páginas;
  - los flujos de conexión de Messenger, Instagram y WhatsApp.
- **Token de Meta y nonce de WhatsApp.** Son por persona, no por tenant: Juan y Pedro no se pisan
  la autorización.
- **Solo dueño** (`requireOwner`, verificado en el servidor): webhook, secreto de firma, API keys,
  Checkout y Portal de Stripe, borrar la cuenta y administrar clientes.
- **API externa.** Se autentica con API key, que es del dueño, y ve todo el tenant.

## Estado de los PRs

El orden importa: **#144 → #145 → #146 → PR 4**. Los PRs 2 y 3 están apilados.

| PR | Rama | Base | Estado |
|---|---|---|---|
| [#144](https://github.com/AI-Beat-Automations/resender/pull/144) Base | `agency-model` | `dev` | Abierto, sin mergear |
| [#145](https://github.com/AI-Beat-Automations/resender/pull/145) Acceso acotado | `agency-model-pr2` | `agency-model` | Abierto, sin mergear |
| [#146](https://github.com/AI-Beat-Automations/resender/pull/146) Clientes e invitaciones | `agency-model-pr3` | `agency-model-pr2` | Abierto, sin mergear |
| PR 4 Correo y documentación | — | — | Pendiente |

**Cómo mergear sin perder cambios:**

1. Mergear #144 a `dev`. El deploy de staging aplica la migración 0025 **solo a la base de
   staging**.
2. Cambiar la base de #145 a `dev` y recién ahí mergearlo. Si se mergea con la base
   `agency-model`, los cambios no llegan a `dev`.
3. Lo mismo con #146: cambiar la base a `dev` antes de mergearlo.

### PR 1 — Base (#144)

Sin cambio de comportamiento para las cuentas actuales.

- **Migración `0025_agency_clients.sql`.**
- **Actor y alcance**, aplicados en:
  - el registro de conexiones;
  - el Inbox;
  - los medios de WhatsApp;
  - la selección de páginas;
  - los tres flujos de conexión.
- **Token de usuario de Meta y nonce de WhatsApp** por persona.
- **Gates vía actor** en el layout de `(product)`, las 6 rutas start/callback de Meta, la ruta de
  medios y las actions de conexión.
- **Solo dueño:** guardar `webhookUrl` y rotar el secreto.
- **PIN de WhatsApp:** respeta el alcance y ahora exige suscripción activa.
- **Borrador de la ADR 0020.**

### PR 2 — Acceso acotado (#145)

- **Pantalla `/access`.** La ve un cliente cuya agencia no tiene acceso activo. Nunca muestra
  precios.
- **Solo dueño** en API keys, `startCheckout`, `openPortal` y borrado de cuenta. `/billing` y
  `/billing/success` mandan a los clientes a `/access`.
- **Interfaz por rol:**
  - **Sidebar:** sin Docs y con el nombre del cliente.
  - **Ajustes:** solo la pestaña Cuenta, sin el ID de tenant ni borrar cuenta.
  - **Tarjeta de conexión:** sin webhook ni secreto, que tampoco viajan en el payload.
  - **Cupo:** sin contadores de plan.
  - **Barra de cuota:** "Habla con tu agencia" en vez del CTA de facturación.
- **Cupo lleno para un cliente,** en los tres canales: "El plan de tu agencia no tiene conexiones
  libres", sin números.

### PR 3 — Clientes e invitaciones (#146)

- **Conexiones para el dueño:**
  - "+ Nuevo cliente" en la cabecera.
  - Un bloque por cliente con su estado.
  - Botón Invitar.
  - Menú con: cancelar invitación, quitar acceso, renombrar y borrar.
  - Grupo "Sin asignar" con "Asignar cliente" / "Mover a otro cliente".
- **Invitación:**
  - El enlace se muestra una sola vez, sirve una sola vez, vence en 7 días y generar uno nuevo
    anula el anterior.
  - El token va en la query (`/invite?token=…`) y en la base solo queda su hash.
- **`/invite`:**
  - Sin sesión ofrece "Crear cuenta" o "Ya tengo cuenta".
  - Con sesión ofrece aceptar, o explica por qué esa cuenta no puede.
  - Aceptar es una sola sentencia atómica, con límite de intentos por IP.
- **Login, registro y Google** vuelven a `/invite` después de entrar. `?invite=` solo se acepta con
  forma de token, así que no sirve como open redirect.
- **PostHog** oculta `invite` además de `token`. `/invite` y `/access` quedan fuera de `robots.ts`
  y del pixel de X.
- **Borrar la cuenta del dueño** también borra a las personas de sus clientes.
- **Log:** acciones nuevas `agency_client_*` y `connection_assign`.

**Archivos principales:**
- `lib/clients/`: `client-repository.ts`, `invite-token.ts`, `client-name.ts` y sus tests.
- `features/clients/`: las actions, `new-client-dialog`, `client-actions-menu` y
  `assign-connection-menu`.
- `features/client-invite/` y `app/invite/page.tsx`.
- `app/(product)/connections/page.tsx` y su `@header`.

## Verificación hecha

- **1358 tests pasan** en #146 (1314 en #144, 1327 en #145). Typecheck, lint y formato están
  limpios en lo que tocó cada PR.
- **Pruebas contra un Postgres real en memoria:**
  - `db/migrations/migrations.test.ts`: foreign keys cross-tenant, `set null` al borrar un cliente,
    unicidades y cascada.
  - `lib/clients/agency-isolation.test.ts` comprueba que:
    - Pedro no ve páginas, conversaciones, mensajes ni medios de María, ni forzando ids;
    - el enlace es de un solo uso y el nuevo anula el anterior;
    - la invitación atada a un correo solo la acepta ese correo;
    - una cuenta con datos propios no puede aceptar;
    - revocar, borrar y asignar funcionan;
    - otro tenant no toca clientes ajenos.
- **No verificado todavía:**
  - Las pantallas en el navegador. El `.env` local apunta a una base de Neon que no está confirmado
    que sea staging, así que la app no se levantó.
  - `check:bundle`, que necesita un build.

## Cómo probar en staging

Todo en `staging.resender.dev` y su base, **nunca en producción**.

**Con #144 y #145 mergeados, antes de #146**, la membresía se crea a mano en la base de staging:

```sql
insert into agency_clients (tenant_id, name)
  values ('<uuid dueño>', 'Cliente de prueba') returning id;
insert into agency_client_members (user_id, agency_client_id, tenant_id)
  values ('<uuid persona>', '<id cliente>', '<uuid dueño>');
```

**Con #146 mergeado**, desde la app, usando tres navegadores (Juan, Pedro y María):

1. Juan crea "Panadería Pedro", invita y copia el enlace.
2. Pedro abre el enlace, crea su cuenta, acepta y conecta Instagram. La conexión aparece en el
   grupo de Pedro. María no la ve.
3. Juan asigna a María una página que tenía en "Sin asignar". María la ve junto con su Inbox.
4. Pedro ve el PIN de su número de WhatsApp.
5. Pedro fuerza `/inbox?conversation=<id de María>` y `?page=<página de María>`: no ve nada. Un
   `curl` a `/api/meta/whatsapp/media/<id de María>` con la cookie de Pedro da 404.
6. Pedro entra a `/settings?tab=api-keys` y a `/billing`, e intenta las acciones de cliente por
   POST: todo bloqueado. El HTML de Conexiones no contiene la `webhookUrl`.
7. Juan quita el acceso a Pedro: la request siguiente de Pedro va a `/login`.
8. Se cancela la suscripción de Juan: Pedro ve `/access`, no los precios.
9. Un enlace reusado, vencido, abierto con una cuenta con datos propios o con otro correo: se
   rechaza.
10. Juan borra su cuenta: la fila `users` de Pedro desaparece.

## Lo que queda por hacer

### Inmediato

- [x] **PR 3:** commit, push y PR apilado sobre `agency-model-pr2` (#146).
- [ ] Revisar y mergear #144, #145 y #146 en orden, cambiando la base a `dev` antes de cada
  merge.
- [ ] Probar en staging el recorrido de arriba.

### PR 4 — Correo y documentación

- [ ] **Correo de invitación desde Resender.** Si Juan escribe un correo, además de atar el enlace
  se lo manda a Pedro. Incluye:
  - `lib/email/client-invite-email.ts`, siguiendo el patrón de `account-linked-email`;
  - la plantilla en Resend y `RESEND_TEMPLATE_CLIENT_INVITE` en los dos entornos de
    `wrangler.jsonc`;
  - la copia en `docs/email/client-invite.html`;
  - los textos en `content/i18n/{es,en}.ts`.

  Si el envío falla, se le dice a Juan; el enlace sigue copiable.
- [ ] **`CONTEXT.md`, términos nuevos:** [Agencia], [Cliente de agencia], [Acceso de cliente],
  [Enlace de invitación], [Actor] y [Asignación de conexión]. Hay que aclarar que "cliente" a
  secas sigue siendo el cliente de Resender.
- [ ] **`CONTEXT.md`, entradas a actualizar:** [Tenant], gates, [Ownership de páginas],
  [Selección de páginas], Connections, Settings, API keys, [Borrado de cuenta], [Canal de correo],
  [Aviso de cuota] y [Cuenta restringida].
- [ ] Pasar la ADR 0020 a `accepted`.

### Arreglos detectados, fuera del modo agencia

- [ ] **`.prettierrc`** apunta a `packages/ui/src/styles/globals.css`, que no existe desde el
  aplanado (#142), y formatear cualquier `.tsx` falla. Hay que apuntarlo a `app/globals.css`.
- [ ] Borrar las carpetas locales sin trackear `apps/` y `packages/`, que sobraron del aplanado
  (tienen un `.env` y builds viejos).
- [ ] Correr `check:bundle` con un build antes del deploy.

### Mejoras posibles, no comprometidas

- [ ] Estado vacío de Conexiones con un camino "Crear un cliente e invitarlo".
- [ ] Varias personas por cliente: borrar el índice `agency_client_members_one_per_client` y
  ajustar la UI.
- [ ] `agencyClientId` en el payload del push al webhook y en `/v1/pages`. Cambia el contrato
  público, así que requiere coordinación.
- [ ] Mitigar la cuota compartida: hoy un cliente con mucho tráfico puede agotar la cuota de la
  agencia y restringir a todos.
- [ ] Una persona que quiera ser cliente de dos agencias (hoy no se puede) o una cuenta que sea
  dueña y cliente a la vez.

## Riesgos conocidos

- **Regresiones de autorización.** Layout, slot `@header` y página se renderizan en paralelo, y las
  actions se pueden llamar por POST directo. Cada entrada resuelve el actor por su cuenta. Toda
  pantalla o acción nueva tiene que usar `getProductActor`/`scopeOf` o `requireOwner`, nunca
  `session.user.id` como tenant.
- **Cuota compartida.** Un post viral de un cliente puede dejar restringida a toda la agencia.
- **Reasignar mueve el historial.** El cliente nuevo ve las conversaciones anteriores de esa
  conexión; el menú lo advierte.
- **El enlace de invitación es un secreto portador.** Va solo en la query, nunca en logs, y en la
  base solo queda su hash.
