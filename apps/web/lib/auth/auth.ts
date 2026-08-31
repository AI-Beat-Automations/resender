import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"
import { NeonDialect } from "kysely-neon"

import { getNeonClient } from "@/lib/db"

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
    // Better Auth lee `BETTER_AUTH_SECRET` y cae a `AUTH_SECRET`. Se explicita
    // el primero para que los dos convivan sin pisarse: `AUTH_SECRET` sigue
    // vivo como pepper de las API keys (`lib/api-keys/*`) hasta el escalón 3, y
    // borrarlo invalidaría todas las keys emitidas.
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
    emailAndPassword: { enabled: true },

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
    plugins: [nextCookies()],
  })
}
