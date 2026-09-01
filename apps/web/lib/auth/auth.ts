// Ruta dedicada del paquete propio del plugin, **nunca un barril**: desde 1.7
// `apiKey` no vive más en `better-auth` y tiene su propio paquete, así que
// importar de acá no arrastra ningún otro plugin al bundle del Worker.
import { apiKey } from "@better-auth/api-key"
import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"
import { NeonDialect } from "kysely-neon"

import { localeFromPathname, localePath, type Locale } from "@/content/i18n"
import { getNeonClient, getSql } from "@/lib/db"
import { sendPasswordResetEmail } from "@/lib/email/password-reset-email"
import { describeError, log } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

// El idioma del [Enlace de recuperacion] es el de la pantalla donde se lo
// pidió, no el de la cuenta: no existe idioma por cuenta (CONTEXT.md →
// [Preferencia de idioma]). Viaja como el `callbackURL` que el server action le
// pasó a `forgetPassword`, que es lo único que el callback de la librería
// recibe además del usuario.
function localeFromResetUrl(url: string): Locale {
  try {
    const callbackUrl = new URL(url, "http://localhost").searchParams.get(
      "callbackURL"
    )
    return localeFromPathname(callbackUrl ?? "/")
  } catch {
    return "es"
  }
}

// Configuración única de Better Auth, la autoridad de sesión y credenciales de
// `apps/web` (ADR 0014). Nadie más en el repositorio llama a `betterAuth()`.
//
// **NUNCA metas una bandera de acceso acá.** Ni `user.additionalFields` ni
// `session.additionalFields` con `waitlisted`, `instagram_enabled`,
// `whatsapp_enabled` ni el estado de suscripción. Esas cuatro se leen vivas
// contra la base en cada request y son fail-closed (`lib/auth/waitlist.ts`,
// `lib/auth/channel-access.ts`, `lib/billing/subscription.ts`). Meterlas en la
// sesión las mete además en la cookie de caché, que vive hasta cinco minutos:
// aprobar, revocar o degradar una cuenta dejaría de pegar en la siguiente
// request. Es la "optimización" natural que alguien va a querer hacer, y es un
// bug de seguridad, no una mejora. Ver CONTEXT.md → [Gate de acceso].

// El init de Better Auth es **perezoso a propósito**: `betterAuth()` construye
// su contexto en una promesa que valida `BETTER_AUTH_SECRET` y, con
// `NODE_ENV=production`, tira si falta. `next build` corre con
// `NODE_ENV=production` y sin secretos —los mismos que `lib/db.ts` evita leer
// en build—, así que una instancia a nivel de módulo rompería el build con una
// promesa rechazada que nadie espera. Memoizada acá, el contexto se construye
// en la primera request, que es cuando el Worker sí tiene sus variables.
let instance: ReturnType<typeof createAuth> | undefined

export function getAuth() {
  return (instance ??= createAuth())
}

export type Auth = ReturnType<typeof createAuth>

function createAuth() {
  return betterAuth({
    // Explícito y no por descubrimiento: Better Auth también aceptaría
    // `AUTH_SECRET` como respaldo, y ese secreto ya no existe en ninguna parte
    // del repositorio desde que las API keys pasaron al plugin. Nombrar el
    // único que vale evita que un día alguien lo reviva sin querer.
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: process.env.BETTER_AUTH_URL
      ? [process.env.BETTER_AUTH_URL]
      : [],

    // El adaptador Postgres built-in detecta el driver con `if ("connect" in
    // db)`, y el cliente HTTP de Neon (`neon()`) no tiene `.connect`: pasárselo
    // directo tira "Failed to initialize database adapter". La salida sin
    // cambiar el driver del resto de la app es darle un dialecto de Kysely
    // sobre el mismo cliente HTTP.
    //
    // La fábrica es lazy (`() => getNeonClient()`) para no leer `DATABASE_URL`
    // en build, igual que `lib/db.ts`.
    //
    // `transaction: false` es **obligatorio**: `NeonDriver.beginTransaction`
    // rechaza transacciones interactivas —el driver HTTP no las tiene—. Con
    // `type: "postgres"` el adaptador Kysely nunca llama a `db.transaction()`
    // (solo lo hace en las ramas de mysql), así que la degradación es a
    // ejecución secuencial sin atomicidad. Consecuencia asumida: un alta que
    // crea la fila de `users` y falla al crear la de `auth_accounts` deja un
    // usuario sin credencial. Es exactamente el mismo riesgo que el repo ya
    // corre hoy con Auth.js, y se arregla a mano borrando esa fila.
    database: {
      dialect: new NeonDialect({ neon: () => getNeonClient() }),
      type: "postgres",
      transaction: false,
    },

    // `advanced.database.casing: "snake"` existe en los tipos pero **no está
    // implementado** en 1.7.2: el mapeo va a mano, campo por campo. El `id` no
    // es mapeable y por eso no aparece en ningún `fields`.
    user: {
      modelName: "users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "auth_sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      // Siete días de inactividad, que se renuevan solos cada veinticuatro
      // horas de uso: quien entra seguido no se desloguea nunca.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // `enabled` viene en `false` por defecto. Sin esto, cada request del
      // producto sumaría un round-trip HTTP a Neon solo para resolver la
      // sesión. Con el caché, la fila de `auth_sessions` sigue siendo la fuente
      // de verdad, pero se la lee como mucho una vez cada cinco minutos: borrar
      // la fila deja fuera a esa sesión recién cuando el caché vence. Para una
      // lectura autoritativa hay `getSession({ fresh: true })` en
      // `lib/auth/session.ts`.
      cookieCache: { enabled: true, maxAge: 60 * 5, strategy: "jwe" },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    advanced: {
      database: {
        // Función y **no** el literal `"uuid"`: con `"uuid"` y un adaptador
        // Postgres, Better Auth omite `id` del INSERT y delega en el default de
        // la columna. `users.id` tiene `gen_random_uuid()`, pero
        // `auth_sessions.id`, `auth_accounts.id` y `auth_verifications.id` son
        // `text` **sin default** (migración 0020) y el INSERT reventaría.
        // La función es global —recibe `{ model }`— y el uuid entra tal cual en
        // la columna `uuid` de `users` y como texto en las otras tres.
        generateId: () => crypto.randomUUID(),
      },
      // Explícito y derivado de la URL, no de `ENVIRONMENT`: producción y
      // staging son los dos https y los dos tienen que emitir la cookie con
      // `Secure` (y con el prefijo `__Secure-`), mientras que `next dev` corre
      // sobre http y ahí un `true` fijo dejaría la cookie sin escribir. Un
      // `false` explícito pisaría la detección de la librería, así que se
      // calcula en vez de constantearse.
      useSecureCookies: (process.env.BETTER_AUTH_URL ?? "").startsWith(
        "https://"
      ),
    },

    // Sin `password.hash`/`verify` custom: scrypt nativo de la librería. Borrar
    // la criptografía propia es la mitad del motivo de la ADR 0014.
    emailAndPassword: {
      enabled: true,

      // El canal de correo que la ADR 0014 no tenía, y con el que existe la
      // [Recuperacion de password] (issue #93).
      //
      // ⚠️ **Canal lateral de tiempo, asumido a sabiendas.** El envío es
      // inline, así que un email que existe tarda ~300 ms más que uno que no.
      // La librería mitiga el *lookup* con un id falso y una consulta dummy,
      // pero no el envío. Es medible por alguien paciente; la alternativa
      // (`advanced.backgroundTasks.handler` con `waitUntil`) es una bandera
      // **global** que cambiaría toda tarea de fondo que la librería corra hoy
      // o mañana, y `getCloudflareContext()` lanza fuera del Worker.
      sendResetPassword: async ({ user, url, token }) => {
        // El idioma llega **dentro de `url`**: el server action pasa
        // `redirectTo: localePath("/reset-password", lang)` y acá se recupera
        // leyendo el parámetro `callbackURL` de esa URL. **Nadie navega a
        // `url`**: se le parsea el querystring y se descarta, porque el enlace
        // que viaja en el correo lo arma este mismo callback contra
        // `BETTER_AUTH_URL`. No es código muerto: borrar esto rompe el inglés
        // y ningún test de UI lo nota (vitest no ejecuta `.tsx`).
        const locale = localeFromResetUrl(url)

        // `BETTER_AUTH_URL` y **nunca `APP_URL`**: `APP_URL` apunta a un túnel
        // ngrok porque es el `redirect_uri` que Meta exige, mientras que
        // `BETTER_AUTH_URL` ya vale el origen real en los dos entornos y es
        // además el de `trustedOrigins`. Usarlo mantiene el enlace y la cookie
        // en el mismo origen por construcción.
        // El `url` que arma la librería (`<baseURL>/reset-password/<token>?
        // callbackURL=…`) **no se usa como enlace**: el correo lleva una URL
        // propia del producto. La nativa parece phishing justo donde la
        // confianza lo es todo, y muere con 403 si `APP_URL` y
        // `BETTER_AUTH_URL` divergen.
        const base = process.env.BETTER_AUTH_URL ?? ""
        const resetUrl = `${base}${localePath("/reset-password", locale)}?token=${encodeURIComponent(token)}`

        const result = await sendPasswordResetEmail({
          to: user.email,
          locale,
          resetUrl,
        })

        // `sendTemplateEmail` nunca lanza, así que el fallo llega acá como
        // dato. Se registra —es lo único que hace visible una caída de
        // Resend— y **no se le informa a quien lo pidió**: decirlo revelaría
        // que la cuenta existe.
        if (!result.ok) {
          log({
            entrypoint: "action",
            action: "email_send",
            outcome: "failed",
            reason: result.reason ?? "internal_error",
            status: result.status,
            errorMessage: result.error ?? undefined,
          })
        }
      },

      // Una hora. Explícito aunque coincida con el default de la librería,
      // porque es una regla del producto que [Enlace de recuperacion] promete
      // por escrito, en el correo y en la pantalla de vencido.
      resetPasswordTokenExpiresIn: 3600,

      // La propiedad de seguridad central: el caso típico de recuperación es
      // que alguien más entró. Sin esto, recuperar una cuenta robada no la
      // recupera, y la recuperación quedaría **más débil** que el cambio de
      // contraseña de Ajustes, que sí revoca.
      //
      // ⚠️ **Ventana de cinco minutos, asumida.** Revocar borra las filas de
      // `auth_sessions`, pero la cookie es un caché JWE con cinco minutos de
      // vida (ver `session.cookieCache` arriba): quien tenga la sesión abierta
      // conserva el acceso durante esa ventana. Es un techo del diseño de la
      // ADR 0014, no de esta entrega, y achicarlo penaliza cada request.
      revokeSessionsOnPasswordReset: true,

      // Corre **antes** que la revocación de sesiones, así que va envuelto en
      // `try/catch` completo: una excepción acá se saltearía la revocación y
      // la feature perdería su parte de seguridad sin que nada falle
      // visiblemente.
      onPasswordReset: async ({ user }) => {
        try {
          // ⚠️ **`email_verified` queda con población mixta.** Pasa a valer
          // `true` para quien recuperó y sigue en `false` para todos los
          // demás, así que **no** responde "¿el alta verificó el correo?".
          // Alguien va a leerlo como si cumpliera la precondición de
          // proveedores sociales de `docs/adr/0014:107`, y **no la cumple**:
          // esa precondición es sobre el alta.
          if (!user.emailVerified) {
            await getSql()`
              update users set email_verified = true where id = ${user.id}
            `
          }

          log({
            entrypoint: "action",
            action: "password_reset",
            outcome: "ok",
            tenantId: user.id,
          })

          if (posthog) {
            posthog.capture({
              distinctId: user.id,
              event: "user reset password",
            })
            await posthog.flush()
          }
        } catch (error) {
          log({
            entrypoint: "action",
            action: "password_reset",
            outcome: "failed",
            reason: "internal_error",
            tenantId: user.id,
            errorMessage: describeError(error),
          })
        }
      },
    },

    // Vacío hasta que el alta con contraseña exija verificación de email. Es la
    // precondición bloqueante de la ADR 0014: sin verificación, cualquiera
    // registra el email de otro y hereda su tenant cuando esa persona entre por
    // el proveedor social.
    socialProviders: {},

    // El interno viene **encendido en producción** con storage `"memory"`, que
    // en Workers es un Map por isolate: no limita nada real y gasta CPU en el
    // camino crítico. El límite de verdad es el binding nativo de Cloudflare,
    // en `lib/auth/rate-limit.ts`.
    rateLimit: { enabled: false },

    // `nextCookies()` va **último**: es un hook `after` que copia las cookies
    // que emite la librería al store de Next. Sin él un server action no puede
    // escribir la cookie de sesión, y el login "funciona" sin dejar sesión.
    // `apiKeyPlugin()` va antes, como cualquier otro plugin.
    plugins: [apiKeyPlugin(), nextCookies()],
  })
}

// Las API keys opacas de la integración externa (`pk_live_*`), única
// implementación desde el escalón 3 de la ADR 0014. Del plugin se usa lo mínimo
// —emitir, verificar y revocar— y se apaga todo lo demás: lo que no se apaga acá
// cambia el comportamiento de las keys sin que nadie lo haya decidido.
//
// Sale de `createAuth()` y se exporta **para que `lib/auth/api-keys.test.ts`
// corra contra esta configuración y no contra una copia**. Lo que ese test
// protege —que el tenant que resuelve una key sea el `users.id` correcto y que
// el prefijo visible siga siendo `pk_live_` + 8— depende de estos valores, y una
// segunda copia en el test los dejaría de cubrir en cuanto divergieran.
export function apiKeyPlugin() {
  return apiKey({
    // Mapeo al estilo del repo, igual que los otros cuatro modelos.
    // Cuatro campos se traducen y no se calcan, para conservar el
    // vocabulario que ya usan CONTEXT.md y la pantalla de Ajustes:
    // `name`→`label`, `start`→`visible_prefix`, `key`→`secret_hash` y
    // `lastRequest`→`last_used_at`. El `id` no es mapeable, como siempre.
    schema: {
      apikey: {
        modelName: "auth_api_keys",
        fields: {
          configId: "config_id",
          name: "label",
          start: "visible_prefix",
          referenceId: "user_id",
          key: "secret_hash",
          refillInterval: "refill_interval",
          refillAmount: "refill_amount",
          lastRefillAt: "last_refill_at",
          rateLimitEnabled: "rate_limit_enabled",
          rateLimitTimeWindow: "rate_limit_time_window",
          rateLimitMax: "rate_limit_max",
          requestCount: "request_count",
          lastRequest: "last_used_at",
          expiresAt: "expires_at",
          createdAt: "created_at",
          updatedAt: "updated_at",
        },
      },
    },

    // El formato visible no cambia: `pk_live_` + 64 caracteres de secreto,
    // y de eso se guardan los 16 primeros —`pk_live_` + 8— como prefijo
    // visible, exactamente el mismo largo y la misma forma que emitía
    // `lib/api-keys/tokens.ts`. Ver [API Token] en CONTEXT.md.
    defaultPrefix: "pk_live_",
    defaultKeyLength: 64,
    startingCharactersConfig: {
      shouldStore: true,
      charactersLength: 16,
    },

    // La etiqueta es obligatoria y llega hasta 80 caracteres, que es el
    // límite que ya validaba el producto y que declara el `maxLength` del
    // formulario. El default del plugin son 32 y cortaría etiquetas que hoy
    // se aceptan.
    requireName: true,
    minimumNameLength: 1,
    maximumNameLength: 80,

    // Las tres cosas que el plugin ofrece y que **están fuera de alcance**
    // (issue #88). Apagadas explícitamente y no por omisión:
    //
    //   - Rate limit por key: el límite real del producto es el binding
    //     nativo de Cloudflare (`lib/auth/rate-limit.ts`). En `false` el
    //     plugin igual refresca `last_used_at` en cada verificación, que es
    //     el dato que la lista de Ajustes muestra.
    //   - Expiración: las keys viven hasta revocación manual. Sin default y
    //     con el `expiresIn` del cliente rechazado, `expires_at` es siempre
    //     null y la barrida de expiradas nunca las toca.
    //   - Metadata (y, con ella, permisos por key): cada key autentica todo
    //     el tenant, como hasta ahora.
    rateLimit: { enabled: false },
    keyExpiration: {
      defaultExpiresIn: null,
      disableCustomExpiresTime: true,
    },
    enableMetadata: false,

    // **No** se cambia a `true`. Con esto encendido, una API key en la
    // cabecera abriría una sesión de Better Auth con el usuario dueño de la
    // key: la credencial de máquina pasaría a valer como la de la persona en
    // toda la app, incluidas las pantallas de Ajustes. La API externa
    // verifica su key contra `lib/auth/api-keys.ts` y nada más.
    enableSessionForAPIKeys: false,
  })
}
