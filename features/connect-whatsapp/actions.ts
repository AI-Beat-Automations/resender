"use server"

import { cookies } from "next/headers"

import { getSession } from "@/lib/auth/session"
import { getAppDict } from "@/lib/i18n/app-dict"
import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { resolveActorByUserId } from "@/lib/clients/actor"
import {
  connectGateError,
  resolveConnectGate,
} from "@/lib/clients/connect-gate"
import { describeError, log } from "@/lib/observability/logger"
import { getWhatsappGeneratedPin } from "@/lib/pages/page-registry"

import { issueSignupNonce } from "./signup-nonce"

// Las dos cosas que el launcher necesita del servidor y que no son el cierre
// del onboarding: el nonce con el que se arma, y el PIN que le tenemos que
// poder devolver al cliente.
//
// El cierre en sí **no** está acá: vive en `POST /api/meta/whatsapp/callback`,
// porque es el gemelo del callback de los otros dos canales y porque el
// launcher lo dispara con un `fetch` en el mismo tick en el que llega el `code`
// —que vive 30 segundos— sin pasar por un `<form>`.

export type WhatsappSignupNonceState = {
  nonce?: string
  error?: string
}

/**
 * Emite el nonce y lo siembra en la cookie.
 *
 * **La emite una acción y no la pantalla** por una limitación real de Next: un
 * Server Component no puede escribir cookies durante el render, así que un
 * `nonce` calculado en la página y pasado como prop no tendría con qué
 * compararse. Y no puede pedirse dentro del `onClick` tampoco: `FB.login` tiene
 * que invocarse de forma síncrona o el navegador bloquea el popup. El launcher,
 * por tanto, la llama al montarse y se guarda el nonce en estado, listo para el
 * clic.
 */
export async function issueWhatsappSignupNonce(): Promise<WhatsappSignupNonceState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  // Los mismos gates que el cierre, y por el mismo motivo: emitir un nonce a
  // quien no puede conectar sería dejarle abrir el diálogo de Meta para que su
  // autorización muera al volver. Por actor (issue #154): el cliente conecta
  // con la suscripción y el permiso de canal del padre.
  const gate = await resolveConnectGate(session.user.id)
  if (gate.kind !== "ok") return { error: connectGateError(gate, t) }
  if (!(await resolveWhatsappAccess(gate.actor.tenantId))) {
    return { error: t.actions.whatsappNotEnabled }
  }

  // Atado al user de la sesión y no al tenant: el cierre lo consume con el
  // mismo id, y para un cliente el tenant es el del padre.
  const store = await cookies()
  return { nonce: issueSignupNonce(store, gate.actor.userId) }
}

export type WhatsappPinState = {
  pin?: string
  error?: string
}

/**
 * Le devuelve al cliente **su** PIN de verificación en dos pasos.
 *
 * Solo el que generamos nosotros (`whatsapp_pin_generated = true`). Ese caso no
 * es una comodidad: al registrar un número sin 2FA le activamos la verificación
 * con un PIN que nadie más conoce, Meta no lo vuelve a mostrar y no hay endpoint
 * para leerlo. Sin esto el cliente se queda con la 2FA puesta y un PIN que no
 * puede recuperar ni acá ni en ninguna otra plataforma.
 *
 * El que aportó el cliente no se enseña nunca: devolvérselo sería publicar en
 * una pantalla un secreto que él ya tiene, y la consulta lo excluye en el
 * `where` con `coalesce(..., false)` —«no consta» cae del lado de no
 * enseñarlo—.
 */
export async function revealWhatsappPin(
  connectionId: string
): Promise<WhatsappPinState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  // El actor decide de qué tenant es la conexión y, si es un cliente, que solo
  // pueda leer el PIN de **sus** números (issue #154).
  const resolution = await resolveActorByUserId(session.user.id)
  if (resolution.kind !== "actor") return { error: t.actions.notSignedIn }
  const { actor } = resolution

  // El gate de canal también acá: quitarle el permiso a una cuenta tiene que
  // cerrar todas las puertas del canal, no solo la de conectar.
  if (!(await resolveWhatsappAccess(actor.tenantId))) {
    return { error: t.actions.whatsappNotEnabled }
  }

  try {
    const pin = await getWhatsappGeneratedPin(
      actor.tenantId,
      connectionId,
      actor.clientAccountId
    )
    if (!pin) {
      // El mismo mensaje para «no es tuya», «no existe» y «el PIN lo pusiste
      // tú»: distinguirlos le contaría a quien prueba ids ajenos cuáles
      // existen.
      return {
        error: t.actions.whatsappNoPin,
      }
    }

    log({
      entrypoint: "action",
      action: "account_connect",
      outcome: "ok",
      channel: "whatsapp",
      tenantId: actor.tenantId,
      connectionId,
    })

    return { pin }
  } catch (error) {
    log({
      entrypoint: "action",
      action: "account_connect",
      outcome: "failed",
      reason: "internal_error",
      channel: "whatsapp",
      tenantId: actor.tenantId,
      connectionId,
      // Nunca el PIN, ni siquiera al fallar de descifrarlo.
      errorMessage: describeError(error),
    })
    return {
      error:
        "No pudimos leer el PIN ahora mismo. Vuelve a intentarlo en un momento.",
    }
  }
}
