# ADR 0014 — Better Auth reemplaza a Auth.js

- **Estado:** aceptado
- **Fecha:** 2026-08-31
- **Relacionada:** supera a `docs/clerk-auth-migration-plan.md`, que queda como histórico no ejecutado

## Contexto

`apps/web` autentica con Auth.js v5 beta, provider `Credentials`, sesión JWT stateless. Cuatro límites motivan el cambio: no se puede revocar una sesión desde el servidor; el login no tiene rate limit; hay criptografía de contraseñas propia (`lib/auth/password.ts`, scrypt de Node con `r=8`); y agregar proveedores sociales exigiría construir a mano el modelo de cuentas por proveedor y el linking.

El hecho que define el margen de maniobra: **no hay terceros en producción**. Las únicas cuentas son propias y de prueba. Eso permite decisiones que con clientes serían inviables — descartar hashes, reemitir credenciales, hacer el cutover sin ventana.

## Decisión

Better Auth reemplaza a Auth.js como única autoridad de sesión y credenciales de `apps/web`.

**`users` es el modelo `user` de Better Auth**, mapeado con `modelName: "users"` y `fields`. El `users.id` uuid sigue siendo el tenant; las 13 foreign keys que lo referencian no se tocan.

Las decisiones que cuelgan de esa raíz:

- **Contraseñas:** scrypt nativo de Better Auth. Se borra `lib/auth/password.ts` y se dropea `users.password_hash`. Las cuentas existentes reciben una credencial nueva con un script de una sola vez que **conserva su uuid**.
- **Sesión:** fila en `auth_sessions` como fuente de verdad, más `cookieCache` con `strategy: "jwe"` y `maxAge` de 5 minutos como camino de lectura. `expiresIn` 7 días, `updateAge` 24 horas: la sesión desliza mientras se use, y muere a los 7 días de inactividad.
- **Gates fuera de la sesión:** `waitlisted`, `instagram_enabled`, `whatsapp_enabled` y el estado de suscripción no entran a `session.additionalFields` ni al cookie cache. Se siguen leyendo vivos contra la base en cada request, fail-closed.
- **Nombres de tabla:** prefijo `auth_` y plural, siguiendo el estilo del repo: `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_api_keys`.
- **Esquema:** migraciones numeradas a mano dentro de la cadena `_echo_migrations`, cubiertas por el test de PGlite. No se usa `@better-auth/cli migrate`.
- **Login:** los server actions sobreviven y por dentro llaman `auth.api.signInEmail` / `signUpEmail`, con el plugin `nextCookies()` último en el array.
- **Rate limit:** binding nativo de Cloudflare (`AUTH_RATE_LIMITER`, namespace 1004, 10 por 60 s) aplicado en los server actions **y** en el `POST` del route handler, porque `/api/auth/*` queda públicamente expuesto.
- **API keys:** se adopta el plugin `apiKey` de Better Auth. Las keys emitidas se reemiten; `lib/api-keys/*` y la tabla `api_keys` se borran.
- **Cambio de contraseña:** se conserva la regla actual —no exige la contraseña anterior— pero ahora revoca todas las demás sesiones, que es lo que la tabla de sesiones hace posible.
- **Entrega:** stack de 3 PRs encadenados sobre `dev`.

## Considered Options

### Identidad

- **Tablas propias de Better Auth más una columna de enlace (`users.auth_user_id`).** Es el patrón que proponía el plan de Clerk, y ahí tenía sentido porque Clerk es un servicio externo. **Rechazada:** Better Auth no es externo. Cada alta —incluidas todas las de OAuth— necesitaría un `databaseHooks.user.create.after` propio que cree la fila de tenant; si ese hook falla queda una identidad viva sin tenant, y hay que escribir la reconciliación. Además suma una query o un join por request para resolver el tenant.
- **Reescribir las 13 foreign keys a ids de texto de Better Auth.** **Rechazada:** migración de datos sobre 7 tablas, no reversible en caliente, y para los proveedores sociales no compra nada que la opción elegida no dé ya. Contradice el precedente escrito en `docs/clerk-auth-migration-plan.md:56`.

### Contraseñas

- **Enseñarle a Better Auth el formato propio** (`emailAndPassword.password.hash`/`verify` apuntando a `lib/auth/password.ts`). Nadie pierde su contraseña. **Rechazada:** obliga a mantener criptografía propia indefinidamente y a quedarse con scrypt `r=8` en vez del `r=16` nativo, a cambio de ahorrar un cambio de contraseña sobre tres cuentas propias.
- **Rehash al primer login**, con `verify` entendiendo los dos formatos. **Rechazada:** maquinaria de dos formatos, un hook de escritura en el camino de login y una rama legacy que no muere sola, para migrar tres filas.
- **Forzar reset por correo.** **Rechazada:** no existe canal de correo en el repo, ni `sendResetPassword`, ni pantallas de recuperación.

### Sesión

- **Stateless puro, sin filas de sesión.** **Rechazada por imposible:** Better Auth entra en modo stateless únicamente cuando no se configura base de datos, y acá la base es obligatoria. `storeSessionInDatabase: false` sin `secondaryStorage` no tiene efecto.
- **Fila de sesión sin cookie cache** (el default de la librería). **Rechazada:** suma un round-trip HTTP a Neon en cada request del producto, de 3 a 4, sin pool persistente porque el runtime es Workers.
- **Sesiones en Cloudflare KV** vía `secondaryStorage`. **Rechazada:** infra nueva a administrar en dos entornos y consistencia eventual, que degrada justamente la revocación que motivaba tener sesiones.
- **Cookie de 30 días, o techo duro de 7 sin deslizamiento.** **Rechazadas:** con fila de sesión el deslizamiento es una línea de config, así que no hay razón para cobrarle re-logins a un usuario activo que hoy no se desloguea nunca.

### Cutover

- **Convivencia de dos autoridades**, con Better Auth en un `basePath` distinto y migración pantalla por pantalla. **Rechazada:** dos cookies vivas producen gates contradictorios según la pantalla, y obliga a decidir cuál manda en cada uno de los 25 call sites. Ya estaba descartada por escrito en `docs/clerk-auth-migration-plan.md:42`.
- **Puente criptográfico** que descifre la cookie de Auth.js con el `AUTH_SECRET` viejo y emita una sesión de Better Auth, para que nadie se desloguee. **Rechazada:** código de autenticación propio y desechable que, si tiene un error, es un bypass de login — a cambio de ahorrar un único `/login` sobre cuentas propias.

### Nombres

- **Defaults de Better Auth** (`user`, `session`, `account`, `verification`, `apiKey`). **Rechazada:** `user` es palabra reservada en Postgres y hay que citarla siempre; el estilo del repo es plural y snake_case; `account` pisa el vocabulario de «Cuenta conectada», que en pantalla significa una página de Facebook o una cuenta de Instagram; y `apiKey` convive con `api_keys` como dos tablas casi homónimas.
- **Renombrar `account` a `auth_credentials`** para eliminar el choque de raíz. **Rechazada:** el rename es a medias —las columnas siguen llamándose `provider_id` y `account_id`— y obliga a traducir la documentación oficial en cada lectura. El prefijo `auth_` ya acota la palabra lo suficiente.

### Esquema

- **`@better-auth/cli migrate`.** **Rechazada:** aplica directo contra la base, por fuera de `_echo_migrations` (`scripts/migrate.mjs:25-45`), y quedaría invisible para `db/migrations/migrations.test.ts`, que corre la cadena completa contra PGlite, y para `npm run db:migrate -w web` de `deploy.yml:28`. Dos cadenas de migración es exactamente la divergencia que ese test existe para impedir. El CLI sí se usa en modo `generate`, como fuente del SQL que se pega en el archivo numerado.

### Login y rate limit

- **Cliente de Better Auth en el formulario** (`authClient.signIn.email()`). **Rechazada:** reescribe `auth-form.tsx` y borra los server actions, mueve el rate limit fuera del action, y los errores igual hay que mapearlos al diccionario porque vuelven como códigos en inglés.
- **`rateLimit` propio de Better Auth con `storage: "database"`.** **Rechazada:** dos escrituras a Neon por intento, por HTTP, de modo que un atacante que martilla el endpoint le cuesta escrituras a la base aunque el límite lo frene. Además no está claro que corra cuando el server action invoca `auth.api.*` en proceso, con lo cual haría falta el binding igual.

### Proveedores sociales

- **Linking automático por email sin exigir verificación.** **Rechazada:** es account pre-hijacking servido. Alguien registra con contraseña un email ajeno —hoy nadie verifica que sea suyo—, el dueño real entra con Google, Better Auth los vincula, y el atacante conserva acceso al tenant con su propia contraseña.
- **No vincular nunca automáticamente**, exigiendo entrar con contraseña y vincular desde Settings. **Rechazada:** funciona sin depender del correo, pero le pide al usuario justamente la contraseña que venía a evitar. Se prefiere el linking con verificación, aceptando que la verificación es una precondición bloqueante.

### API keys

- **Dejar `lib/api-keys/*` como está** y blindar el pepper seteando `API_KEY_PEPPER` explícito. **Rechazada:** mantiene dos sistemas de credenciales conviviendo. Sin clientes en producción, reemitir las keys es un trámite y no un evento, así que se prefiere consolidar de una vez.

### Entrega

- **Un solo PR** (~58 archivos, un cutover). **Rechazada:** un PR de ese tamaño no se revisa de verdad y su revert se lleva puesto también el login que ya funcionaba.
- **Cinco escalones**, aislando el campo `name` y la migración de los 25 call sites en PRs propios. **Rechazada:** más rebases y ceremonia de los que el tamaño del proyecto justifica.

## Consequences

**Positivas**

- Se pueden revocar sesiones desde el servidor, cosa que hoy es imposible.
- El login pasa a tener rate limit, que hoy no tiene.
- Las contraseñas usan scrypt `r=16` en vez de `r=8`, y desaparece la criptografía propia.
- El esquema queda listo para proveedores sociales: los tokens caen en `auth_accounts` y el handshake OAuth en `auth_verifications`, sin tocar el modelo de tenant.
- Una sola autoridad de credenciales para la sesión web y para la API.

**Negativas y deuda declarada**

- **Los hashes de contraseña existentes se pierden.** Las cuentas actuales reciben una contraseña nueva puesta a mano por un script. Viable solo porque no hay terceros; con clientes reales esta decisión habría sido la contraria.
- **Todas las API keys emitidas se invalidan** y hay que reemitirlas y pegarlas de nuevo en cada integración.
- `auth_accounts` convive en la base con «Cuenta conectada», que es otra cosa. El prefijo acota pero no elimina el solapamiento.
- `users` gana tres columnas que existen porque la librería las pide (`name`, `email_verified`, `image`), no porque el dominio las necesite. `image` queda sin uso hasta que haya un proveedor social.
- **No hay pantalla para editar el nombre.** Las cuentas que no pasen por el alta nueva dependen del script.
- El cambio de contraseña sigue sin exigir la anterior. Es una decisión, no un olvido: quien tenga acceso a una sesión abierta puede apoderarse de la cuenta. Se acepta a sabiendas y queda escrito acá.
- Se depende de un `beta`/versión fija de una librería externa para el camino crítico de autenticación.

**Precondición bloqueante**

> **No se habilita ningún proveedor social —Google, GitHub, X o cualquier otro— hasta que el alta con contraseña exija verificación de email.** Con `accountLinking.trustedProviders` y sin verificación, cualquiera puede registrar el email de otra persona y heredar su tenant cuando esa persona entre por el proveedor. La verificación exige un canal de correo que el repositorio no tiene. Mientras no exista, `socialProviders` queda vacío.

**Cumplida el 2026-09-01**, por el issue [#98](https://github.com/AI-Beat-Automations/resender/issues/98) (*Google como proveedor social, con verificación de correo en el alta*). Las dos causas cayeron por separado: el canal de correo lo construyó el #93 (Resend), y la verificación del alta la trae el #98. La solución final **no fue** ninguna de las dos alternativas que esta ADR evaluó en «Proveedores sociales» —ni el linking automático sin verificar, ni no vincular nunca y obligar a entrar con contraseña—, y tampoco la verificación *bloqueante* que este párrafo daba por supuesta: el alta con contraseña manda un correo de confirmación pero **sigue abriendo sesión**, y lo que cierra el robo por registro anticipado es el candado nativo de la librería, `accountLinking.requireLocalEmailVerified` (default `true`), sin `trustedProviders`, que se niega a vincular Google a una cuenta local cuyo correo no está confirmado. Google **se suma y no reemplaza**: vincularlo nunca borra la contraseña, y cada vinculación sobre una cuenta que ya la tenía se avisa por correo. `socialProviders` deja de estar vacío con `google`; la decisión completa, sus alternativas descartadas y la consecuencia asumida viven en el issue, no en una ADR nueva.
