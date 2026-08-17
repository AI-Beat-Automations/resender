# Plan — Migración de Auth.js a Clerk con Google y email/contraseña

## Estado del documento

- **Fecha:** 2026-08-17.
- **Objetivo:** reemplazar Auth.js por Clerk como única autoridad de identidad,
  credenciales y sesiones del dashboard.
- **Métodos de acceso iniciales:** Google OAuth y email/contraseña.
- **Arquitectura relacionada:**
  [Fase 2 — API migration/frontend](./phase-2-api-migration-frontend.md).
- **Estado:** propuesta revisada; los controles de identidad, recuperación de
  sesión y operación descritos aquí son requisitos de implementación. No se ha
  provisionado ni modificado infraestructura externa.
- **Revisión independiente:** observaciones del subagente Claude incorporadas el
  2026-08-17 y contrastadas contra el código actual.

## Resultado esperado

Al terminar:

1. Un usuario puede registrarse o iniciar sesión con Google.
2. Un usuario puede registrarse o iniciar sesión con email y contraseña.
3. El registro con email exige verificar el correo.
4. Google y contraseña con el mismo email verificado resuelven a una sola
   cuenta de Clerk y a un solo tenant de Resender.
5. Clerk es el único dueño de passwords, recuperación, sesiones y cookies de
   autenticación.
6. El UUID actual de `users.id` continúa siendo el identificador de tenant y no
   se reescriben foreign keys.
7. `apps/web` autentica con Clerk y provisiona el tenant inicialmente mediante
   un adapter server-only contra PostgreSQL; migrar ese adapter al Service
   Binding privado `BACKEND` es una fase posterior y no bloquea el cutover.
8. `apps/api` no instala Clerk, no valida tokens de Clerk y no recibe cookies de
   Clerk.
9. La API pública `/v1` continúa aceptando exclusivamente API keys de Resender.
10. El navegador nunca recibe una API key para operar el dashboard.
11. Cada tenant queda ligado de forma autoritativa a un solo `clerk_user_id`
    mediante una restricción única en PostgreSQL.

## Decisiones aprobadas por este plan

### Una sola autoridad de autenticación

Clerk reemplaza completamente a Auth.js. No se mantiene Clerk para Google y
Auth.js para passwords: dos autoridades implicarían dos cookies, dos flujos de
recuperación, sesiones divergentes y riesgo de duplicar tenants.

La preparación y migración de datos será incremental, pero el cambio de la
autoridad de sesión en producción será un cutover atómico.

### El tenant sigue siendo el UUID interno

`users.id` permanece como UUID y sigue siendo la raíz de ownership para Pages,
conversaciones, mensajes, comentarios, suscripciones y API keys.

Cada usuario de Clerk guardará ese UUID en `externalId` y la fila `users`
guardará el identificador opaco de Clerk en `clerk_user_id` con un índice único.
El binding en base de datos es la fuente autoritativa para impedir que dos
identidades Clerk reclamen el mismo tenant; `externalId` permite reconciliar y
evita reescribir foreign keys.

La plantilla del token de sesión expondrá un claim pequeño y explícito:

```json
{
  "tenantId": "{{user.external_id}}"
}
```

No se reemplaza el claim nativo `sub`: `sub` sigue siendo el ID de Clerk y
`tenantId` es el UUID de dominio. Separar ambos evita confundir identidad de
autenticación con identidad del negocio. El claim es un camino rápido, no una
precondición: si todavía falta, Next resuelve el tenant server-side usando
`clerk_user_id` y el email primario verificado.

### Clerk termina en `apps/web`

`apps/web` será responsable de:

- integrar `@clerk/nextjs` y `@clerk/ui`;
- verificar la sesión Clerk con `await auth()`;
- alojar las pantallas de sign-in/sign-up;
- completar el onboarding de un usuario que todavía no tenga `externalId`;
- exigir que el email usado para provisioning sea el primario y esté verificado;
- actualizar `externalId` mediante el Backend API de Clerk;
- forzar el refresh del token después del onboarding;
- recuperar sesiones Clerk huérfanas mediante sign-out explícito;
- provisionar inicialmente contra PostgreSQL mediante un adapter server-only;
- conservar redirects, UX de formularios, revalidation y PostHog.

`apps/api` continuará siendo responsable de:

- garantizar unicidad de email y ownership;
- conservar DB, billing, API keys, entitlements e integraciones;
- ejecutar todas las reglas de dominio;
- atender `/v1`, webhooks de Meta/Stripe, Queue, DLQ y scheduled recovery.

El cutover de identidad no depende de terminar el Slice 0 de la Fase 2. Cuando
el Service Binding esté listo, el adapter de provisioning se moverá a
`WebAppApi` sin cambiar su contrato ni semántica.

La información de Clerk persistida en el dominio se limita a
`clerk_user_id` como identificador externo opaco y, durante provisioning, el
email primario verificado obtenido por Next. No cruza una sesión, cookie ni
token de Clerk al Worker `api`; guardar un ID opaco no introduce una dependencia
del SDK de Clerk, igual que guardar un `stripe_customer_id`.

## Arquitectura objetivo

```text
                                 +----------------------------+
Browser                          | apps/web                   |
  |                              | Next 16 / OpenNext        |
  | Clerk cookie                 | ClerkProvider + proxy.ts  |
  +----------------------------->| auth() + Server Actions    |
                                 +----------+------------------+
                                            |
                                            | adapter server-only
                                            | Postgres ahora;
                                            | Service Binding después
                                            v
Developers + API key              +---------+------------------+
  +-----------------------------> | apps/api / dominio        |
                                  | WebAppApi RPC + Hono /v1  |
Meta / Stripe webhooks            | DB + Meta + Stripe        |
  +-----------------------------> | Queue + DLQ + scheduled   |
                                  +----------------------------+
```

Hay dos superficies en el mismo backend y no deben confundirse:

| Superficie               | Consumidor  | Autenticación                                              |
| ------------------------ | ----------- | ---------------------------------------------------------- |
| Provisioning server-only | `apps/web`  | sesión Clerk verificada + adapter interno                  |
| `WebAppApi` RPC privado  | `apps/web`  | confianza del Service Binding + actor derivado server-side |
| HTTP `/v1`               | developers  | `Authorization: Bearer pk_live_...`                        |
| HTTP `/webhooks/*`       | Meta/Stripe | firma propia de cada proveedor                             |

## Estado actual relevante

- `apps/web/auth.ts` usa Auth.js Credentials y JWT.
- `apps/web/lib/auth/password.ts` guarda passwords en el formato propio
  `scrypt$<salt-base64url>$<hash-base64url>`.
- `apps/api` contiene otra implementación compatible de ese verificador para la
  Fase 2.
- `users.id` es UUID y `users.password_hash` actualmente es `not null`.
- `RpcActorSchema` ya exige `{ userId: UUID }`.
- `WebAppApi` ya expone métodos privados para el dashboard, pero `apps/web` aún
  no tiene configurado el binding `BACKEND`.
- `apps/web` todavía accede directamente a PostgreSQL y conserva callbacks y
  webhooks que la Fase 2 trasladará a `apps/api`.
- El proyecto usa Next `16.2.x`; la convención correcta es `proxy.ts`, no
  `middleware.ts`.

## Flujos de identidad

### Registro nuevo con email/contraseña

```text
/register
  -> Clerk crea usuario con email + password
  -> Clerk envía código de verificación
  -> usuario verifica email
  -> Clerk crea sesión
  -> /auth/complete detecta tenantId ausente
  -> Next confirma email primario verificado
  -> adapter resuelve usuario por clerkUserId o reclama email sin dueño
  -> dominio devuelve users.id UUID
  -> Next guarda UUID como Clerk externalId
  -> cliente fuerza refresh del token
  -> token nuevo contiene tenantId
  -> redirect a /connections o al gate correspondiente
```

La contraseña nunca cruza a `apps/api` y no se vuelve a almacenar en
PostgreSQL.

### Registro nuevo con Google

Es el mismo flujo, salvo que Google y Clerk verifican la identidad y no existe
password. Después del OAuth, `/auth/complete` provisiona el UUID interno antes
de permitir entrar al producto.

### Cuenta existente

Antes del cutover, cada fila de `users` se importa a Clerk con:

- email actual;
- `externalId = users.id`;
- `createdAt` original cuando sea posible;
- password digest, únicamente si el spike de compatibilidad confirma que Clerk
  puede validarlo de forma exacta.

La importación también persiste el `clerk_user_id` devuelto por Clerk en la fila
correspondiente. La reconciliación debe comprobar la relación 1:1 en ambos
sentidos: `users.id <-> clerk_user_id <-> externalId`.

El token de la primera sesión ya contiene `tenantId`, por lo que una cuenta
existente no pasa por creación de tenant.

### Vinculación Google/password

Clerk vincula Google con una cuenta de password que tenga el mismo email
verificado. Debe mantenerse `Verify at sign-up` habilitado para reducir riesgo
de account takeover y evitar dos usuarios Clerk para el mismo email. El dominio
no confía únicamente en ese linking: un `clerk_user_id` diferente nunca puede
reclamar un tenant que ya tenga dueño, aunque el email coincida.

Se deben probar explícitamente ambas direcciones:

- password primero, Google después;
- Google primero, añadir password después.

### Provisioning idempotente

Definir un contrato interno que inicialmente implementa `apps/web` contra
PostgreSQL y que después puede exponerse sin cambios en `WebAppApi`:

```ts
resolveOrCreateDashboardUser(input: {
  clerkUserId: string
  email: string
}): Promise<AuthenticatedUserDto>
```

Condiciones:

- nunca se publica como ruta HTTP ni se llama desde el navegador;
- Next obtiene `clerkUserId` con `auth()` y exige
  `primaryEmailAddress.verification.status === "verified"`;
- usa exclusivamente el email primario y lo normaliza como el modelo actual;
- busca primero por `clerk_user_id` y devuelve esa fila;
- si encuentra el email con `clerk_user_id = null`, lo reclama con un
  `UPDATE ... WHERE clerk_user_id IS NULL RETURNING ...` atómico;
- si encuentra el email ligado a otro `clerk_user_id`, falla cerrado con
  `identity_conflict`; nunca devuelve el tenant;
- si no existe, crea una fila con `password_hash = null` y el
  `clerk_user_id` autenticado;
- resuelve carreras por email o Clerk ID releyendo la fila ganadora y aplicando
  las mismas comprobaciones;
- no recibe `tenantId` desde el navegador;
- no registra email completo, password, cookie o token en logs;
- conserva los defaults actuales de waitlist y permisos de canal.

La migración aditiva requerida es conceptualmente:

```sql
alter table users add column clerk_user_id text;
create unique index users_clerk_user_id_key
  on users (clerk_user_id)
  where clerk_user_id is not null;
```

### Helper único de actor en Next

Crear un helper server-only, por ejemplo
`apps/web/lib/auth/require-dashboard-actor.ts`, que:

1. ejecuta `await auth()`;
2. rechaza una sesión no autenticada o pendiente;
3. si `sessionClaims.tenantId` existe, lo valida como UUID y lo usa;
4. si falta, resuelve o provisiona server-side con `clerkUserId` y el email
   primario verificado, sin depender del refresh del claim;
5. devuelve `{ userId: tenantId, clerkUserId }`;
6. solo redirige a `/auth/complete` cuando la resolución server-side también
   falla de forma recuperable;
7. ante `unknown_user`, `identity_conflict` o tenant borrado redirige a
   `/auth/recover`, que ejecuta `signOut()` antes de volver a `/login`.

Todos los Server Components, Server Actions y Route Handlers privados deben usar
ese helper. Ninguna acción acepta `userId` o `tenantId` enviado por un form.

## Spike obligatorio: compatibilidad de passwords existentes

Los hashes actuales se generan con `node:crypto.scrypt` y un formato propio.
Clerk soporta variantes concretas, entre ellas `scrypt_werkzeug`, pero eso no
demuestra que el string actual sea importable sin transformación.

Antes de decidir la experiencia de migración:

1. Confirmar en desarrollo si Clerk respeta los parámetros embebidos en un hash
   `scrypt_werkzeug` o si impone defaults propios.
2. Crear en local un fixture con password conocido usando el código actual.
3. Documentar los parámetros efectivos: `N=16384`, `r=8`, `p=1` y
   `dklen=64`, que son los defaults usados actualmente por Node.
4. Transformar únicamente encoding y envoltura al formato documentado. El salt
   se copia como texto, sin decodificar base64url; el digest base64url se
   convierte a hexadecimal sin recalcularlo.
5. Importar el fixture en una instancia Clerk de desarrollo.
6. Confirmar login exitoso con el password conocido y rechazo con uno distinto.
7. Confirmar si Clerk rehace el hash después del primer login.
8. Confirmar si un usuario creado por Backend API queda con el email verificado;
   de ello dependen reset y linking con Google.
9. Repetir con caracteres Unicode y password de longitud mínima.
10. No ejecutar una importación real hasta que el fixture sea reproducible en
    un test/script revisable.

### Gate de decisión

**Si la transformación es compatible:**

- hacer importación bulk de email, digest y `externalId`;
- los usuarios conservan su password;
- eliminar los hashes de PostgreSQL solo después de la ventana de rollback.

**Si la transformación no es compatible:**

- importar email y `externalId`, sin password, verificando explícitamente cómo
  marcar el email como verificado de forma segura;
- comunicar que el primer acceso por password requiere “Olvidé mi contraseña”;
- permitir acceso inmediato con Google cuando coincida el email verificado;
- no construir un puente permanente que mande passwords desde Clerk a la API.

La incompatibilidad de un formato de hash no justifica mantener dos sistemas de
sesión en producción.

## Estrategia de interfaz

Para la primera entrega se usarán los componentes prebuilt de Clerk, tematizados
con `@clerk/ui` y el tema shadcn del proyecto. Esto reduce superficie de errores
en:

- verificación de email;
- recuperación de password;
- errores de OAuth;
- linking;
- sesiones pendientes y client trust.

Las rutas actuales `/login`, `/register`, `/en/login` y `/en/register` se
conservan para no romper enlaces ni SEO, pero renderizan Clerk o redirigen a las
rutas canónicas configuradas. Un flujo completamente custom queda fuera de la
primera entrega.

Configuración inicial de Clerk:

- email requerido;
- verificación por código al registrarse;
- password habilitado para sign-up y sign-in;
- Google habilitado para sign-up y sign-in;
- bloqueo de subaddresses de Google habilitado salvo decisión explícita;
- cambios de email deshabilitados al inicio hasta implementar sincronización con
  `users.email`;
- Organizations, Clerk Billing, passkeys y MFA obligatorio fuera de alcance.

## Rutas y protección

Usar estrategia **public-first** en `apps/web/proxy.ts`: el sitio tiene marketing,
blog, docs y callbacks públicos. `clerkMiddleware()` da contexto, pero la
autorización se aplica cerca del recurso.

Rutas públicas:

- marketing, blog, pricing, waitlist, legal, RSS, `llms.txt` y assets;
- `/login(.*)`, `/register(.*)` y equivalentes en inglés;
- `/auth/recover`, que exige una sesión Clerk, ejecuta `signOut()` y termina en
  `/login` sin sesión;
- endpoints de Auth.js únicamente durante la preparación, nunca después del
  cutover;
- endpoints máquina-a-máquina todavía alojados en `web`, con su autenticación
  propia y excluidos explícitamente de protección Clerk:
  - `/api/meta/send`;
  - `/api/meta/instagram/send`;
  - `/api/meta/instagram/comments/reply`;
  - `/api/meta/instagram/comments/private-reply`;
  - `/api/meta/webhook`;
  - `/api/meta/instagram/webhook`;
  - `/api/stripe/webhook`;
- otros callbacks externos todavía alojados en `web` durante su ventana de
  compatibilidad, con su verificación de firma/state existente.

Rutas autenticadas:

- `/auth/complete` requiere sesión Clerk, pero permite `tenantId` ausente;
- `/connections(.*)`, `/inbox(.*)`, `/settings(.*)` y `/billing(.*)` requieren
  sesión activa y `tenantId` válido;
- cada Server Action vuelve a autenticar; proteger el layout no protege la
  mutación;
- una sesión Clerk válida sin tenant resoluble nunca rebota entre `/login` y el
  dashboard: termina en `/auth/recover` y se cierra explícitamente;
- `/auth/complete` limita reintentos y ofrece salida a `/auth/recover` si no
  puede completar provisioning o refrescar el claim.

No agregar Clerk middleware a `api.resender.dev`: es otro Worker y conserva su
middleware Hono de API keys.

## Fases de ejecución

### Fase 0 — Inventario y decisiones operativas

- [ ] Contar usuarios totales, activos en 30/90 días y usuarios con suscripción.
- [ ] Estimar coste de Clerk con MAU actuales y proyección a 12 meses; definir
      umbral de go/no-go.
- [ ] Auditar colisiones con
      `select lower(email), count(*) ... having count(*) > 1` y revisar
      subaddresses antes de exportar.
- [ ] Confirmar si una ventana breve de mantenimiento es aceptable.
- [ ] Confirmar si preservar passwords existentes es requisito duro o si se
      acepta reset cuando el spike falle.
- [ ] Inventariar redirects y URLs externas que apuntan a `/login` o `/register`.
- [ ] Guardar baseline de login/register errors y sesiones activas.
- [ ] Asignar owner y fecha objetivo a cada fase.
- [ ] Definir duración de la ventana de rollback y responsable del cutover.
- [ ] Decidir explícitamente si se acepta la protección de bots de Clerk o si se
      configura otra política acorde al contexto del producto.

**Salida:** checklist operativo aprobado y decisión bulk import vs reset.

### Fase 1 — Instancias y configuración de Clerk

- [ ] Crear o vincular instancia de desarrollo.
- [ ] Crear instancias separadas de staging y producción; no intentar promover
      usuarios de development a production.
- [ ] Habilitar email/password y verificación por código.
- [ ] Habilitar Google con credenciales compartidas solo en development.
- [ ] Crear credenciales Google propias para staging/production y verificar
      origins y redirect URI.
- [ ] Configurar dominios, redirect URLs y Home URL por ambiente.
- [ ] Provisionar y verificar los DNS de producción requeridos por Clerk
      (`clerk`, `accounts`, `clkmail`, `clk._domainkey` y `clk2._domainkey`) con
      proxy de Cloudflare desactivado cuando Clerk así lo requiera.
- [ ] Registrar esos DNS y su owner en
      `docs/cloudflare-infra-checklist.md`.
- [ ] Configurar el claim `tenantId` desde `user.external_id`.
- [ ] Configurar `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` como variable de build en
      CI, staging y producción, e incluirla en `turbo.json:globalEnv` para evitar
      reutilizar bundles cacheados con una instancia incorrecta.
- [ ] Configurar `CLERK_SECRET_KEY` como secreto runtime independiente por
      ambiente mediante Wrangler; nunca exponerlo como variable pública.
- [ ] No crear ninguna variable Clerk en `apps/api`.
- [ ] Actualizar los tres workflows y la documentación de secretos sin
      commitear valores reales.

**Salida:** Account Portal y Google funcionan aisladamente en cada ambiente.

### Fase 2 — Contrato y adapter server-only sin dependencia del Service Binding

El cutover de identidad no se combina con el Slice 0 de la Fase 2 del backend.
`apps/web` ya tiene acceso a PostgreSQL, por lo que el primer adapter usa ese
camino existente. La interfaz se diseña para poder sustituir la implementación
por `BACKEND` después, sin cambiar los consumidores.

- [ ] Crear una interfaz server-only única para provisioning en `apps/web`.
- [ ] Implementarla inicialmente contra PostgreSQL con la semántica fail-closed
      de la Fase 3.
- [ ] Confirmar que ningún Client Component puede importar o invocar el adapter.
- [ ] Mantener fuera del cutover la configuración de `BACKEND` y sus
      prerrequisitos de despliegue.
- [ ] Registrar como trabajo posterior del Slice 0: configurar bindings por
      ambiente, regenerar tipos, implementar el adapter RPC y ejecutar smokes
      local/OpenNext antes de cambiar la implementación activa.

**Salida:** Next puede provisionar de forma segura sin introducir a la vez un
nuevo camino de red; la migración posterior a RPC queda encapsulada.

### Fase 3 — Provisioning de tenant

- [ ] Hacer `users.password_hash` nullable mediante migración aditiva.
- [ ] Añadir `users.clerk_user_id text` nullable e índice único parcial para
      valores no nulos.
- [ ] Mientras las migraciones todavía pertenezcan a `web`, crear la siguiente
      migración consecutiva ahí; mover ownership físico solo en el slice final de
      la Fase 2.
- [ ] Actualizar `UserRecord` y mappers para `passwordHash: string | null`.
- [ ] Hacer que la autenticación legacy rechace limpiamente un hash nulo.
- [ ] Implementar `resolveOrCreateDashboardUser({ clerkUserId, email })` en el
      repository y adapter de `apps/web`; añadir el RPC después del cutover.
- [ ] Exigir email primario verificado antes de invocar el adapter.
- [ ] Resolver primero por `clerk_user_id`; reclamar una fila por email solo si
      todavía no tiene dueño.
- [ ] Devolver `identity_conflict` si el email pertenece a otro Clerk ID.
- [ ] Cubrir idempotencia y carreras concurrentes por email y Clerk ID.
- [ ] Cubrir usuario existente, nuevo, borrado, email inválido/no verificado y
      conflicto de identidad.
- [ ] Añadir logs por operación con `tenantId`, nunca con credenciales.

**Salida:** el dominio puede provisionar usuarios Clerk con binding 1:1
verificable, sin depender del SDK ni de tokens de Clerk.

### Fase 4 — Spike e importador de usuarios

- [ ] Ejecutar el spike de scrypt descrito arriba.
- [ ] Confirmar los parámetros `N=16384`, `r=8`, `p=1`, `dklen=64`, el salt
      como texto y el parseo real del formato por Clerk.
- [ ] Confirmar el estado de verificación del email creado por Backend API.
- [ ] Elegir conservación de password o reset.
- [ ] Construir export read-only desde PostgreSQL.
- [ ] Construir import idempotente a Clerk con rate-limit handling.
- [ ] Guardar `externalId = users.id` para todos los usuarios importados.
- [ ] Persistir el Clerk ID resultante en `users.clerk_user_id` y rechazar
      cualquier relación que no sea 1:1.
- [ ] Producir reporte sin secretos: creados, ya existentes, fallidos y causa.
- [ ] Probar reanudación después de fallo parcial.
- [ ] Probar primero contra datos sintéticos y luego contra staging.

**Salida:** importación ensayada y reconciliación 1:1 por
UUID/Clerk ID/`externalId`.

### Fase 5 — Integración Clerk en Next, todavía sin cutover

- [ ] Instalar la versión current de `@clerk/nextjs` (Core 3, v7+) y `@clerk/ui`.
- [ ] Añadir `ClerkProvider` dentro de `<body>` y conservar PostHog/ThemeProvider.
- [ ] Aplicar el tema shadcn.
- [ ] Crear `apps/web/proxy.ts` con matcher public-first y exclusiones literales
      para todos los endpoints máquina-a-máquina listados en este documento.
- [ ] Crear los tipos globales para `sessionClaims.tenantId`.
- [ ] Implementar `requireDashboardActor()` server-only.
- [ ] Implementar `/auth/complete` con actualización de `externalId` y refresh
      inmediato mediante `user.reload()` o `getToken({ skipCache: true })`.
- [ ] Hacer que el helper resuelva server-side cuando el claim falte; el refresh
      del claim es optimización y no condición para entrar al dashboard.
- [ ] Limitar reintentos de `/auth/complete` y ofrecer salida a
      `/auth/recover`.
- [ ] Evitar `currentUser()` en cada request; usarlo solo donde haga falta email
      completo, especialmente provisioning.
- [ ] Ejecutar `clerk doctor` y resolver todos los hallazgos.

**Salida:** Clerk funciona en preview sin ser todavía la sesión productiva.

### Fase 6 — UI de login, registro y recuperación

- [ ] Reemplazar el formulario Auth.js de `/login` por Clerk con Google y
      email/password.
- [ ] Reemplazar `/register` y sus rutas en inglés.
- [ ] Configurar redirects de éxito hacia `/auth/complete`.
- [ ] Implementar `/auth/recover` para cerrar una sesión Clerk huérfana antes de
      volver a `/login`.
- [ ] Cambiar redirects `unknown_user` del product layout y callbacks de Meta a
      `/auth/recover`, no directamente a `/login`.
- [ ] Evitar que `<SignIn />` redirija automáticamente al producto cuando la
      sesión existente no tenga un tenant válido; mostrar salida de sesión.
- [ ] Validar sign-up con código, sign-in, sign-out y forgot password.
- [ ] Mantener copy y locale del producto alrededor del componente.
- [ ] Confirmar accesibilidad, estados de loading y errores traducidos aceptables.
- [ ] Confirmar que Google y password con el mismo email crean un solo usuario.
- [ ] Mantener `tenantId` como distinct ID de PostHog; no cambiar históricos al
      ID Clerk.

**Salida:** todos los caminos de acceso terminan en una sesión Clerk con UUID.

### Fase 7 — Migrar todos los consumidores de sesión

Reemplazar imports desde `@/auth` y llamadas `auth()` de Auth.js en:

- product layout y páginas de connections, inbox y settings;
- billing y billing success;
- inicio/callback de Meta e Instagram;
- account, API keys, billing, connect-meta y connections actions;
- login/register views y cualquier redirect de sesión huérfana.

Para cada consumidor:

- [ ] derivar actor exclusivamente con `requireDashboardActor()`;
- [ ] conservar redirects waitlist/billing/product;
- [ ] verificar auth al principio de cada Server Action;
- [ ] no aceptar UUID desde `FormData`, params o Client Components;
- [ ] incluir `tenantId` en cualquier cache key privada;
- [ ] llamar al RPC privado para dominio cuando el slice de Fase 2 ya exista.

**Salida:** no queda lógica productiva leyendo la sesión Auth.js.

### Fase 8 — Cuenta, password y eliminación

- [ ] Reemplazar “Cambiar contraseña” por el flujo de Clerk.
- [ ] Quitar `changePassword` del RPC después de la ventana compatible.
- [ ] Mantener cambios de email deshabilitados hasta implementar sincronización
      explícita con `users.email`.
- [ ] Definir la política Clerk -> dominio para usuarios borrados, bloqueados,
      baneados o creados manualmente desde Clerk.
- [ ] Implementar como mínimo una reconciliación periódica que reporte huérfanos
      en ambos sentidos usando `users.clerk_user_id`.
- [ ] Adaptar eliminación de cuenta como saga:
      dominio/API primero, eliminación Clerk después.
- [ ] Si la eliminación Clerk falla después de borrar dominio, cerrar sesión,
      registrar un evento operativo sin PII y reintentar de forma controlada.
- [ ] Probar que una cuenta eliminada no entra en redirect loop.
- [ ] Confirmar que reset/change password invalida sesiones conforme a la
      política elegida.

**Salida:** settings ya no modifica ni conoce hashes locales.

### Fase 9 — Staging y ensayo de cutover

- [ ] Importar una copia representativa de usuarios de staging.
- [ ] Ejecutar la matriz E2E completa.
- [ ] Verificar build OpenNext y `proxy.ts` en Cloudflare.
- [ ] Verificar que Cloudflare Access no bloquee los redirects necesarios de
      staging.
- [ ] Probar pérdida temporal de Clerk y del adapter de provisioning con fallos
      cerrados; probar `BACKEND` solo si el Slice 0 ya fue desplegado.
- [ ] Medir latencia de `auth()` + adapter de dominio y tasa de errores.
- [ ] Ensayar export, import, reconciliación, cutover y rollback con cronómetro.
- [ ] Aprobar runbook antes de tocar producción.

**Salida:** go/no-go firmado con evidencias.

### Fase 10 — Cutover de producción

Orden estricto:

1. activar ventana de mantenimiento para registro/login;
2. tomar export final de `users`;
3. importar/reconciliar en la instancia Clerk de producción;
4. comprobar que cada usuario tiene el `externalId` UUID correcto;
5. desplegar migraciones y adapters aditivos;
6. desplegar `web` con Clerk como única sesión;
7. ejecutar smokes de password, Google, API key y dashboard;
8. reabrir registro/login;
9. observar errores, linking, provisioning y llamadas al adapter.

Los smokes de API key incluyen los endpoints productivos que todavía viven en
`apps/web`, no solamente `/v1`. Después del despliegue se elimina explícitamente
la cookie legacy `authjs.session-token` cuando corresponda al nombre usado en el
ambiente.

Las sesiones Auth.js existentes terminarán en el cutover. Debe comunicarse como
un nuevo inicio de sesión, no tratar de convertir cookies antiguas.

**Punto de no retorno operativo:** el primer usuario nuevo creado solo en Clerk
no puede autenticarse con un rollback puro a Auth.js porque su fila tiene
`password_hash = null`. Después de ese punto se prefiere forward-fix. Si hay que
volver temporalmente, se pausa el registro, se preservan las cuentas nuevas y no
se borra ningún dato Clerk o PostgreSQL.

### Fase 11 — Limpieza después de estabilidad

Solo después de la ventana acordada:

- [ ] eliminar `next-auth` de dependencies;
- [ ] eliminar `apps/web/auth.ts` y `/api/auth/[...nextauth]`;
- [ ] eliminar actions/forms de credentials legacy;
- [ ] eliminar tipos `next-auth.d.ts`;
- [ ] eliminar hash/verify password de `apps/web`;
- [ ] eliminar `authenticateCredentials`, `registerUser` y `changePassword` del
      RPC cuando ningún web desplegado los consuma;
- [ ] eliminar hash/verify password de `apps/api`;
- [ ] eliminar `AUTH_SECRET` de `web`, Turbo, CI y runbooks;
- [ ] decidir una migración posterior para borrar `password_hash` o conservarlo
      temporalmente cifrado/offline según política de rollback;
- [ ] actualizar Fase 2 para cambiar “NextAuth cookie/JWT” por “Clerk
      cookie/session” y retirar el Slice 6 legacy;
- [ ] escribir el ADR `0011-clerk-como-autoridad-de-identidad.md`;
- [ ] actualizar `CONTEXT.md` para retirar las reglas canónicas de Auth.js,
      registro sin verificación y password local obligatorio;
- [ ] actualizar `/privacy` para declarar a Clerk como subprocesador y
      revalidar `/data-deletion` frente al flujo de Meta;
- [ ] completar el Slice 0 y migrar el adapter de provisioning al Service
      Binding solo cuando sus prerrequisitos propios estén aprobados;
- [ ] rotar secretos retirados y verificar con `rg` que no quedan imports.

**Salida:** Clerk es la única autoridad y no queda código de password propio.

## Matriz mínima de pruebas

### Autenticación

- [ ] registro nuevo con email/password y código correcto;
- [ ] código incorrecto, expirado y reenvío;
- [ ] login correcto e incorrecto;
- [ ] recuperación y cambio de password;
- [ ] registro/login nuevo con Google;
- [ ] cancelación y error de Google;
- [ ] password -> Google con mismo email: un usuario/tenant;
- [ ] Google -> password con mismo email: un usuario/tenant;
- [ ] emails distintos: tenants distintos;
- [ ] email no primario o no verificado no puede provisionar;
- [ ] sesión pendiente no entra al dashboard;
- [ ] sesión Clerk válida con tenant borrado termina en `/auth/recover` sin
      bucle de redirects;
- [ ] fallo de refresh del claim no bloquea el acceso si el binding en DB es
      válido;
- [ ] `/auth/complete` agotando reintentos termina en recuperación controlada;
- [ ] sign-out limpia identidad de PostHog y cookie Clerk.

### Migración

- [ ] usuario importado conserva UUID;
- [ ] password importado funciona, si el spike fue aprobado;
- [ ] fallback de reset funciona, si el spike fue rechazado;
- [ ] import duplicado es idempotente;
- [ ] fallo parcial puede reanudarse;
- [ ] reconciliación detecta email, `clerk_user_id` o `externalId` conflictivo;
- [ ] dos Clerk IDs no pueden reclamar el mismo tenant;
- [ ] carreras concurrentes por email terminan con un solo binding;
- [ ] usuario borrado no se recrea accidentalmente sin política explícita.

### Autorización y tenancy

- [ ] usuario A no puede leer/mutar recursos de B cambiando IDs;
- [ ] Server Action sin sesión falla antes del adapter de dominio o RPC;
- [ ] `tenantId` inválido o ausente redirige a onboarding;
- [ ] el actor nunca sale de un input del browser;
- [ ] caches privadas incluyen tenant UUID;
- [ ] PostHog y logs continúan correlacionando por UUID interno.

### API pública

- [ ] API key válida continúa funcionando después del cutover;
- [ ] API key revocada continúa fallando;
- [ ] token/cookie Clerk enviado a `/v1` devuelve `invalid_api_key`;
- [ ] dashboard no llama `/v1` ni crea una API key interna;
- [ ] OpenAPI no documenta Clerk como security scheme;
- [ ] Meta/Stripe webhooks no quedan protegidos por Clerk.
- [ ] `POST /api/meta/send` y los tres endpoints Instagram actuales conservan su
      autenticación API key y nunca redirigen a Clerk;
- [ ] los endpoints máquina-a-máquina no devuelven cookies Clerk ni latencia de
      autenticación innecesaria.

### Runtime

- [ ] `npm run lint`;
- [ ] `npm run typecheck`;
- [ ] `npm run test:run`;
- [ ] `npm run build`;
- [ ] `npm run dev` levanta Next con el adapter PostgreSQL activo;
- [ ] cuando se adopte el Slice 0, un smoke separado valida Next -> Service
      Binding -> API en local y preview;
- [ ] preview OpenNext autentica y refresca claims correctamente;
- [ ] staging y producción usan llaves/Google apps diferentes.

## Observabilidad

Eventos mínimos:

- `auth_sign_in_succeeded` por método (`password` o `google`), sin email;
- `auth_sign_in_failed` con código redactado;
- `auth_provision_started|succeeded|failed` con `tenantId` solo después de
  resolverlo;
- `auth_external_id_updated|failed` sin Clerk secret ni token;
- `auth_identity_conflict` con IDs internos redactados y alerta operativa;
- `auth_recover_started|succeeded|failed` sin cookies ni PII;
- `auth_migration_imported|skipped|failed` por conteo;
- latencia y error del adapter `resolve_or_create_dashboard_user`.

Nunca registrar:

- password o password digest;
- cookies o session tokens;
- Clerk secret key;
- Google client secret;
- códigos de verificación;
- payload completo de Clerk;
- email completo en logs estructurados.

## Rollback

Antes del primer registro Clerk-only:

- redeploy del último `web` con Auth.js;
- conservar migraciones aditivas y hashes;
- no revertir imports ni borrar usuarios Clerk;
- `AUTH_SECRET` permanece disponible durante la ventana acordada.

Después del primer registro Clerk-only:

- preferir forward-fix;
- si Clerk o el deploy impiden operar, activar mantenimiento y pausar nuevos
  registros;
- no intentar autenticar filas con `password_hash = null` mediante Auth.js;
- preservar y reconciliar las cuentas creadas durante la ventana;
- volver a Clerk una vez corregido el incidente.

Además, después del cutover un reset de password en Clerk no actualiza el hash
legacy de PostgreSQL. Un rollback a Auth.js podría reactivar una contraseña vieja
que el usuario considera reemplazada, incluso si la cambió por sospecha de
compromiso. Por ello:

- el runbook identifica las cuentas que resetearon password durante la ventana;
- esas cuentas no vuelven a Auth.js con su hash anterior;
- después de abrir registros o resets en Clerk se prefiere forward-fix y, si es
  necesario, mantenimiento temporal antes que reactivar credenciales obsoletas.

No hacer:

- ejecutar Auth.js y Clerk como autoridades simultáneas indefinidamente;
- copiar passwords en texto plano;
- cambiar UUIDs o foreign keys para facilitar rollback;
- borrar hashes legacy antes de cerrar la ventana;
- aceptar una API key desde Next para simular autenticación de dashboard.

## Criterios de aceptación finales

- [ ] Clerk es la única autoridad de registro, password, Google, recuperación y
      sesión.
- [ ] Todo usuario autenticado tiene exactamente un `tenantId` UUID válido.
- [ ] Cada tenant tiene como máximo un `clerk_user_id` autoritativo y los
      conflictos fallan cerrados.
- [ ] Todo usuario legacy conserva su UUID y sus recursos.
- [ ] Google y password con el mismo email verificado no duplican tenant.
- [ ] `apps/api` no depende de paquetes, llaves, tokens o webhooks de Clerk.
- [ ] `/v1` acepta solo API keys de Resender.
- [ ] Los endpoints con API key y webhooks que sigan en `apps/web` permanecen
      fuera de Clerk y pasan sus smokes productivos.
- [ ] El adapter server-only funciona en local, preview, staging y producción;
      su migración posterior al Service Binding se valida por separado.
- [ ] Ninguna Server Action confía en un tenant recibido del cliente.
- [ ] Una sesión huérfana o un claim sin refrescar nunca produce un bucle de
      redirects.
- [ ] Los flujos de password y Google están cubiertos por pruebas E2E.
- [ ] El import de usuarios es reproducible, idempotente y reconciliado.
- [ ] El runbook de cutover/rollback fue ensayado en staging.
- [ ] Auth.js y los hash helpers propios fueron retirados al cerrar la ventana.

## Referencias vigentes

- [Clerk Next.js quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart)
- [Email/password custom flow](https://clerk.com/docs/guides/development/custom-flows/authentication/email-password)
- [Google social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)
- [OAuth account linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking)
- [Migrating from Auth.js](https://clerk.com/docs/guides/development/migrating/authjs)
- [CreateUser and supported password hashers](https://clerk.com/docs/reference/backend/user/create-user)
- [Customize session tokens](https://clerk.com/docs/guides/sessions/customize-session-tokens)
- [Force a session token refresh](https://clerk.com/docs/guides/sessions/force-token-refresh)
- [Next.js `proxy.ts`](../node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md)
- [Next.js Server Actions security](../node_modules/next/dist/docs/01-app/02-guides/server-actions.md)
