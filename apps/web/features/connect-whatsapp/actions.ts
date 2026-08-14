"use server"

import { randomBytes, timingSafeEqual } from "crypto"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { resolvePlanLimits } from "@/lib/billing/entitlements"
import {
  getSubscriptionByTenantId,
  hasActiveSubscription,
} from "@/lib/billing/subscription"
import {
  assertSecretEncryptionConfigured,
  SecretEncryptionConfigError,
} from "@/lib/crypto/encryption"
import {
  accountFields,
  describeError,
  log,
  type LogReason,
} from "@/lib/observability/logger"
import {
  formatMetaConnectionError,
  whatsappNumberOwnedReason,
} from "@/lib/pages/meta-connection-error"
import {
  connectWhatsappNumber,
  countActivePages,
  resolveWhatsappNumberOwnership,
  PageOwnershipError,
  type WhatsappPinOrigin,
} from "@/lib/pages/page-registry"
import { checkAccountSlotAvailable } from "@/lib/pages/page-selection"
import { posthog } from "@/lib/posthog"
import {
  beginWhatsappSignup,
  finishWhatsappSignup,
  normalizeWhatsappPin,
  WhatsappApiError,
  type WhatsappOnboardingStep,
} from "@/lib/whatsapp"

// Cierre del Embedded Signup de WhatsApp del lado del servidor. El launcher
// —el botón que abre el popup de `FB.login`, que es otro slice— captura el
// `code` y los identificadores que Meta manda por `postMessage`, y llama acá.
// Todo lo que sigue (canje, confirmación de propiedad, registro, suscripción y
// persistencia cifrada) pasa en el servidor: el navegador nunca ve un token.
//
// **Por qué una server action y no un callback OAuth.** Messenger e Instagram
// entran por redirección: Meta navega a `/api/meta/.../callback` y el CSRF lo
// cubre una cookie de `state` que sembró la ruta `/start`. Embedded Signup no
// redirige a ningún sitio: es un popup que devuelve el `code` por `postMessage`
// a la pestaña que lo abrió. Sin navegación de vuelta no hay callback donde
// comparar el `state`, así que esa protección se reconstruye acá con un nonce.

// ---------------------------------------------------------------------------
// El nonce
// ---------------------------------------------------------------------------

// **Dónde vive el nonce: en una cookie httpOnly, no en una tabla.**
//
// Es el mismo papel y el mismo mecanismo que `INSTAGRAM_STATE_COOKIE`
// (`/api/meta/instagram/start`): un valor aleatorio que solo conocen el
// servidor y la pestaña que abrió el flujo, y que tiene que volver intacto para
// que la petición se acepte. Una tabla haría lo mismo a cambio de una migración,
// dos consultas por conexión y filas que hay que barrer; un JWT firmado sin
// estado no se puede consumir de verdad —cualquier copia vale hasta que
// caduca—, y consumirlo es justo lo que se pide. La cookie da el uso único
// gratis: se borra al leerla.
//
// El valor lleva el tenant delante (`${tenantId}.${nonce}`) porque la cookie
// sobrevive a un cambio de sesión en el mismo navegador: sin esa atadura, el
// nonce que emitió una cuenta serviría para cerrar el onboarding de la
// siguiente que iniciara sesión ahí.
const SIGNUP_NONCE_COOKIE = "whatsapp_signup_nonce"

// Diez minutos, como el `state` de Instagram. Es lo que tarda alguien en
// completar el Embedded Signup con calma; más allá, lo honesto es volver a
// empezar, porque el `code` que produzca ese flujo vive 30 segundos igual.
const SIGNUP_NONCE_TTL_SECONDS = 600

export type WhatsappSignupNonceState = {
  nonce?: string
  error?: string
}

// Emite el nonce y lo siembra en la cookie. **La emite una acción y no la
// pantalla** por una limitación real de Next: un Server Component no puede
// escribir cookies durante el render, así que un `nonce` calculado en la página
// y pasado como prop no tendría con qué compararse. Y no puede pedirse dentro
// del `onClick` tampoco: `FB.login` tiene que invocarse de forma síncrona o el
// navegador bloquea el popup. El launcher, por tanto, la llama al montarse y se
// guarda el nonce en estado, listo para el clic.
export async function issueWhatsappSignupNonce(): Promise<WhatsappSignupNonceState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No has iniciado sesión." }

  // Los mismos gates que el cierre, y por el mismo motivo: emitir un nonce a
  // quien no puede conectar sería dejarle abrir el diálogo de Meta para que su
  // autorización muera al volver.
  if (await isUserWaitlisted(session.user.id)) {
    return { error: "Tu cuenta está en la lista de espera." }
  }
  if (!(await hasActiveSubscription(session.user.id))) {
    return { error: "Tu suscripción no está activa." }
  }

  // 32 bytes del CSPRNG: es un secreto de sesión, no un identificador.
  const nonce = randomBytes(32).toString("base64url")

  const store = await cookies()
  store.set(SIGNUP_NONCE_COOKIE, `${session.user.id}.${nonce}`, {
    httpOnly: true,
    secure: true,
    // `lax` y no `strict`: la pestaña que abre el popup es la nuestra, así que
    // la petición de cierre es same-site igual, pero `strict` rompería el caso
    // de quien llega a Conexiones desde un enlace externo.
    sameSite: "lax",
    path: "/",
    maxAge: SIGNUP_NONCE_TTL_SECONDS,
  })

  return { nonce }
}

// Verifica y **consume** el nonce. Se borra la cookie pase lo que pase y antes
// de comparar: si solo se borrara cuando coincide, un atacante tendría intentos
// ilimitados contra la misma cookie, que es exactamente lo que «un solo uso»
// evita. El precio es que un launcher con un bug quema el nonce y obliga a
// pedir otro, que es el lado correcto en el que equivocarse.
async function consumeSignupNonce(
  tenantId: string,
  submitted: string | null
): Promise<boolean> {
  const store = await cookies()
  const cookie = store.get(SIGNUP_NONCE_COOKIE)?.value ?? null
  store.delete(SIGNUP_NONCE_COOKIE)

  if (!cookie || !submitted) return false
  return constantTimeEquals(cookie, `${tenantId}.${submitted}`)
}

// Comparación en tiempo constante. El `===` del `state` de Instagram alcanza
// para un valor que viaja en una URL, pero este nonce se compara contra un
// secreto de 256 bits que el atacante puede sondear a voluntad desde una
// pestaña con sesión: la diferencia de coste es un `Buffer` y no tener que
// razonar sobre si el oráculo es explotable.
function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8")
  const b = Buffer.from(right, "utf8")
  // `timingSafeEqual` lanza si las longitudes difieren, y la longitud no es
  // secreta: el nonce mide siempre lo mismo.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ---------------------------------------------------------------------------
// El cierre del onboarding
// ---------------------------------------------------------------------------

export type ConnectWhatsappActionState = {
  error?: string
  // `true` solo en el 133005: el número ya tenía verificación en dos pasos con
  // un PIN que no es el nuestro. El launcher lo usa para pedir el PIN antes de
  // volver a lanzar el flujo, en vez de repetir el mismo error.
  pinRequired?: boolean
}

type SignupOutcome =
  | { redirectTo: string }
  | { state: ConnectWhatsappActionState }

// Traducción del paso al motivo del catálogo. La convención de
// `meta-connection-error.ts` es `whatsapp_<step>_failed`, uno por miembro de
// `WhatsappOnboardingStep`, justamente para que este mapeo sea una plantilla y
// no una tabla que se desincroniza.
function reasonForStep(step: WhatsappOnboardingStep): string {
  return `whatsapp_${step}_failed`
}

// El motivo del log es del catálogo cerrado de `logger.ts` y no el del
// querystring: uno se filtra en Workers Logs y el otro se le muestra a una
// persona. Van juntos para que no se separen.
const LOG_REASON_BY_STEP: Record<WhatsappOnboardingStep, LogReason> = {
  exchange: "token_exchange_failed",
  assets: "profile_fetch_failed",
  register: "meta_rejected",
  subscribe: "subscription_failed",
  persist: "internal_error",
}

export async function connectWhatsappNumberAction(
  _state: ConnectWhatsappActionState,
  formData: FormData
): Promise<ConnectWhatsappActionState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No has iniciado sesión." }

  // Los mismos gates que protegen las rutas de los otros dos canales, repetidos
  // aunque el layout de `(product)` ya los aplique: una server action se puede
  // invocar por POST directo sin renderizar la pantalla (ver el comentario en
  // `features/connect-meta/actions.ts`).
  if (await isUserWaitlisted(session.user.id)) {
    return { error: "Tu cuenta está en la lista de espera." }
  }
  if (!(await hasActiveSubscription(session.user.id))) {
    return { error: "Tu suscripción no está activa." }
  }

  const tenantId = session.user.id

  // El nonce se consume antes de mirar nada más: es el sustituto del `state` de
  // los otros dos canales y no tiene sentido inspeccionar el resto de un
  // formulario que todavía no probó venir de nuestra pestaña.
  const validNonce = await consumeSignupNonce(
    tenantId,
    readField(formData, "nonce")
  )
  if (!validNonce) {
    log({
      entrypoint: "action",
      action: "oauth_callback",
      outcome: "failed",
      reason: "state_mismatch",
      channel: "whatsapp",
      tenantId,
      // A `warn`, igual que en el callback de Instagram: es un intento de CSRF
      // o dos flujos abiertos a la vez, y las dos cosas ameritan mirarlas.
      level: "warn",
    })
    // El motivo propio de WhatsApp y no el compartido: acá la causa probable no
    // es que la sesión venciera sino que hay otra pestaña de Conexiones abierta
    // que pisó el nonce (la cookie es una sola por navegador). Ver el comentario
    // del catálogo.
    return { error: formatMetaConnectionError("whatsapp_state_mismatch") }
  }

  const code = readField(formData, "code")
  const wabaId = readField(formData, "wabaId")
  const phoneNumberId = readField(formData, "phoneNumberId")
  if (!code || !wabaId || !phoneNumberId) {
    log({
      entrypoint: "action",
      action: "oauth_callback",
      outcome: "failed",
      reason: "missing_code",
      channel: "whatsapp",
      tenantId,
      // Qué faltó, sin decir qué llegó: el `code` no se registra nunca.
      errorMessage: `missing: ${[
        code ? null : "code",
        wabaId ? null : "wabaId",
        phoneNumberId ? null : "phoneNumberId",
      ]
        .filter(Boolean)
        .join(",")}`,
    })
    return {
      error:
        "No se pudo conectar: la autorización volvió incompleta. Vuelve a lanzarla desde el botón.",
    }
  }

  // El PIN, si viene, se valida acá y no dentro del cliente de Meta: el
  // `maxLength={6}` del input es decoración y esta acción se puede invocar por
  // POST directo. Vuelve con `pinRequired` para que el campo siga en pantalla
  // con el mensaje debajo, que es donde está el remedio.
  const submittedPin = readField(formData, "pin")
  let pin: string | null = null
  if (submittedPin !== null) {
    const normalized = normalizeWhatsappPin(submittedPin)
    if (!normalized.ok) {
      log({
        entrypoint: "action",
        action: "account_connect",
        outcome: "failed",
        reason: "invalid_request",
        channel: "whatsapp",
        tenantId,
        // El PIN nunca, ni siquiera el inválido: es la credencial del número.
        errorMessage: "whatsapp pin is not six digits",
      })
      return { pinRequired: true, error: normalized.message }
    }
    pin = normalized.value
  }

  // El cupo del plan, **antes** de tocar Meta. Sin esta puerta el número se
  // conectaba igual y el tenant se pasaba del límite, que es lo que apaga la
  // entrega de sus páginas de Messenger (ver `checkAccountSlotAvailable`).
  const slotError = await checkPlanSlot(tenantId, phoneNumberId)
  if (slotError) return { error: slotError }

  const outcome = await runWhatsappSignup(tenantId, {
    code,
    wabaId,
    phoneNumberId,
    pin,
  })

  if ("state" in outcome) return outcome.state

  // `redirect()` lanza: fuera del try/catch de arriba para que nadie lo confunda
  // con un fallo de la conexión.
  redirect(outcome.redirectTo)
}

async function runWhatsappSignup(
  tenantId: string,
  input: {
    code: string
    wabaId: string
    phoneNumberId: string
    pin: string | null
  }
): Promise<SignupOutcome> {
  // El paso donde estamos, para atribuir un error que no venga tipado. Los
  // `WhatsappApiError` traen el suyo; esto cubre lo demás —una caída de la base
  // en la escritura, sobre todo—, igual que en el callback de Instagram.
  let step: WhatsappOnboardingStep = "exchange"

  try {
    assertSecretEncryptionConfigured()

    // Mitad reversible: canje, `debug_token`, WABA y lista de números. Cuando
    // esto vuelve, en Meta no cambió nada todavía.
    const target = await beginWhatsappSignup({
      code: input.code,
      hint: { wabaId: input.wabaId, phoneNumberId: input.phoneNumberId },
    })

    // **El punto de no retorno está entre estas dos llamadas.** La propiedad se
    // consulta con el `phone_number_id` que confirmó Graph —no con el que dijo
    // el navegador— y antes de suscribir y registrar, porque `/register` activa
    // la verificación en dos pasos con el PIN que le mandemos y eso no se
    // deshace desde acá.
    //
    // El fallo de esta lectura se atribuye a `persist`: es nuestra base, no
    // Meta, y su mensaje («se autorizó pero no se pudo guardar, vuelve a
    // intentarlo») es el correcto. Se aborta en vez de seguir sin respuesta: no
    // poder confirmar de quién es el número no es lo mismo que que sea tuyo.
    step = "persist"
    const ownership = await resolveWhatsappNumberOwnership(
      tenantId,
      target.phone.id
    )
    if (ownership.ownedByOtherTenant) {
      throw new PageOwnershipError(target.phone.id)
    }

    // De dónde sale el PIN, en orden de autoridad: el que escribió el cliente
    // tras un 133005 manda sobre el que tengamos guardado, porque si lo está
    // escribiendo es que el nuestro ya no vale.
    //
    // El origen decide si la tarjeta de Conexiones se lo enseña, así que se
    // mira lo que **cambia** y no quién lo tecleó: si escribió exactamente el
    // que ya teníamos —le pasa a quien lo copia de la propia tarjeta—, el PIN
    // sigue siendo el que generamos nosotros y la marca no se toca.
    const pin = input.pin ?? ownership.storedPin
    const pinOrigin: WhatsappPinOrigin =
      input.pin && input.pin !== ownership.storedPin
        ? "customer"
        : ownership.storedPin
          ? "stored"
          : "generated"

    // Mitad irreversible: suscribir el WABA y registrar el número.
    step = "subscribe"
    const signup = await finishWhatsappSignup(target, {
      // `undefined` = el número no tiene verificación en dos pasos y el cliente
      // la está estrenando con un PIN que generamos nosotros.
      ...(pin ? { pin } : {}),
    })

    step = "persist"
    // Se persiste lo que **confirmó Graph**, no lo que dijo el navegador: el
    // `phoneNumberId` y el `wabaId` que salen de `finishWhatsappSignup` ya
    // pasaron por `debug_token` y por `/{waba_id}/phone_numbers`. Usar acá los
    // del formulario desharía esa validación entera.
    const page = await connectWhatsappNumber(tenantId, {
      phoneNumberId: signup.phoneNumberId,
      wabaId: signup.wabaId,
      wabaName: signup.wabaName,
      phoneE164: signup.phoneE164,
      verifiedName: signup.verifiedName,
      accessToken: signup.accessToken,
      tokenExpiresAt: signup.tokenExpiresAt,
      pin: signup.pin,
      pinOrigin,
      onboardingMode: signup.onboardingMode,
    })

    log({
      entrypoint: "action",
      action: "account_connect",
      outcome: "ok",
      ...accountFields(page),
    })

    if (posthog) {
      posthog.capture({
        distinctId: tenantId,
        event: "whatsapp number connected",
        properties: {
          connection_id: page.id,
          phone_number_id: page.metaPageId,
          waba_id: page.wabaId,
          onboarding_mode: signup.onboardingMode,
          // El booleano, nunca el PIN: distingue «se lo creamos» de «ya lo
          // tenía», que es lo que decide si hay que mostrárselo.
          pin_generated: signup.pinGenerated,
        },
      })
      await posthog.flush()
    }

    revalidatePath("/connections")

    // Solo el número en E.164 viaja en la URL: es lo que el usuario reconoce, y
    // el `phone_number_id` no se parece a nada suyo. El token quedó cifrado en
    // Postgres, y el PIN también: un PIN en el querystring acabaría en el
    // historial del navegador y en los logs del borde.
    const params = new URLSearchParams({ whatsapp: "connected" })
    if (page.phoneE164) params.set("phone", page.phoneE164)
    return { redirectTo: `/connections?${params.toString()}` }
  } catch (error) {
    if (posthog) posthog.captureException(error, tenantId)
    const errorMessage = describeError(error)

    // El 133005 es el único desenlace con una salida clara del lado del
    // cliente, y le va a pasar a cualquiera cuyo número ya tenga verificación en
    // dos pasos. Vuelve como estado del botón y no como aviso de la pantalla
    // porque el remedio está justo ahí: aportar el PIN y volver a lanzar.
    if (error instanceof WhatsappApiError && error.reason === "pin_required") {
      log({
        entrypoint: "action",
        action: "account_connect",
        outcome: "failed",
        reason: "meta_rejected",
        channel: "whatsapp",
        tenantId,
        errorCode: error.metaErrorCode ?? undefined,
        errorMessage,
      })
      return {
        state: {
          pinRequired: true,
          error:
            "No se pudo conectar: el número ya tiene la verificación en dos pasos activada. Vuelve a lanzar la conexión indicando su PIN de seis dígitos, o desactívala desde WhatsApp Manager e inténtalo de nuevo.",
        },
      }
    }

    // De acá abajo todo termina en la pantalla de Conexiones con el mismo aviso
    // que usan Facebook e Instagram: el usuario ya autorizó en Meta y lo que
    // necesita saber es en qué quedó, no qué botón apretó.
    if (error instanceof PageOwnershipError) {
      log({
        entrypoint: "action",
        action: "account_connect",
        outcome: "failed",
        reason: "account_owned_by_other_tenant",
        channel: "whatsapp",
        tenantId,
        accountId: error.metaPageId,
      })
      return failure(whatsappNumberOwnedReason(error.metaPageId))
    }

    if (error instanceof SecretEncryptionConfigError) {
      log({
        entrypoint: "action",
        action: "account_connect",
        outcome: "failed",
        reason: "configuration_failed",
        channel: "whatsapp",
        tenantId,
        errorMessage,
      })
      return failure("configuration_failed")
    }

    const failedStep = error instanceof WhatsappApiError ? error.step : step
    log({
      entrypoint: "action",
      action: "account_connect",
      outcome: "failed",
      reason: LOG_REASON_BY_STEP[failedStep],
      channel: "whatsapp",
      tenantId,
      ...(error instanceof WhatsappApiError && error.metaErrorCode
        ? { errorCode: error.metaErrorCode }
        : {}),
      errorMessage: `${failedStep}: ${errorMessage}`,
    })
    return failure(reasonForStep(failedStep))
  }
}

// El cupo del plan, con el mismo mecanismo que usan la pantalla de selección de
// Facebook y su server action: plan de la suscripción → `resolvePlanLimits` →
// cuentas activas (`countActivePages`, que cuenta Messenger y WhatsApp juntos) →
// módulo puro que decide y redacta.
//
// Devuelve el mensaje a mostrar, o `null` si hay hueco.
//
// **Por qué acá y no al emitir el nonce.** El nonce se emite al montar el
// launcher, cuando todavía no se sabe qué número va a elegir el usuario, y
// bloquearlo ahí dejaría sin poder reconectar a quien está al límite —el botón
// de «Reconectar» de las tarjetas de WhatsApp apunta a este mismo launcher—. Con
// el `phone_number_id` en la mano sí se puede distinguir un número nuevo de uno
// que ya ocupa su hueco.
//
// **La pista del navegador alcanza para esto.** El id que llega en el formulario
// no es autoritativo, pero solo se usa para *conceder* la exención de
// reconexión, y `resolveWhatsappPhoneNumber` (lib/whatsapp) aborta el onboarding
// si el número que Graph devuelve no es exactamente ese: o el flujo sigue con el
// mismo número, o no sigue. El día que entre Coexistence —que no manda
// `phone_number_id`— no habrá pista, no habrá exención, y el cupo se aplicará
// entero, que es el lado correcto en el que fallar.
async function checkPlanSlot(
  tenantId: string,
  phoneNumberId: string
): Promise<string | null> {
  let subscription: Awaited<ReturnType<typeof getSubscriptionByTenantId>>
  let activePageCount: number
  let ownership: Awaited<ReturnType<typeof resolveWhatsappNumberOwnership>>
  try {
    ;[subscription, activePageCount, ownership] = await Promise.all([
      getSubscriptionByTenantId(tenantId),
      countActivePages(tenantId),
      resolveWhatsappNumberOwnership(tenantId, phoneNumberId),
    ])
  } catch (error) {
    // Fail-closed y con mensaje, no con una excepción: esta acción se renderiza
    // como el estado de un botón, así que lanzar acá le mostraría al usuario la
    // pantalla de error de Next en lugar de algo que pueda leer. Y no se sigue
    // adelante: sin saber el cupo, conectar es apostar a que hay hueco.
    log({
      entrypoint: "action",
      action: "account_connect",
      outcome: "failed",
      reason: "internal_error",
      channel: "whatsapp",
      tenantId,
      errorMessage: `plan slot check: ${describeError(error)}`,
    })
    return "No pudimos comprobar el cupo de tu plan ahora mismo. Vuelve a intentarlo en un momento."
  }

  // Plan sin resolver = fail-closed, igual que en `/connections/select` y en la
  // server action de Facebook: no se conectan cuentas sin un límite conocido.
  const limits = resolvePlanLimits(subscription?.priceLookupKey ?? null)
  if (!limits) {
    log({
      entrypoint: "action",
      action: "account_connect",
      outcome: "failed",
      reason: "plan_restricted",
      channel: "whatsapp",
      tenantId,
      errorMessage: "plan limits could not be resolved",
    })
    return "No pudimos resolver los límites de tu plan. Escríbenos a info@resender.dev."
  }

  const slot = checkAccountSlotAvailable({
    activePageCount,
    maxPages: limits.maxPages,
    reconnectingActiveAccount: ownership.activeForTenant,
  })
  if (slot.ok) return null

  log({
    entrypoint: "action",
    action: "account_connect",
    outcome: "failed",
    reason: "page_limit_reached",
    channel: "whatsapp",
    tenantId,
    accountId: phoneNumberId,
    count: activePageCount,
  })
  return slot.message
}

function failure(reason: string): SignupOutcome {
  const params = new URLSearchParams({ whatsapp: "error", reason })
  return { redirectTo: `/connections?${params.toString()}` }
}

function readField(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
