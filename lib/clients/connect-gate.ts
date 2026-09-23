import type { AppDict } from "@/content/i18n/app"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { needsEmailVerification } from "@/lib/billing/free-plan-gate"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import type { LogReason } from "@/lib/observability/logger"

import { isClientActor, resolveActorByUserId, type Actor } from "./actor"

// Los gates que protegen conectar una red —`/api/meta/*/start`, los tres
// callbacks y las server actions de Messenger y WhatsApp— resueltos **por
// actor** (issue #154, ticket 3). Hasta el ticket 2 cada ruta repetía
// «sesión → lista de espera → suscripción» sobre `session.user.id`, y para un
// cliente eso fallaba dos veces: no tiene fila de suscripción propia (la del
// padre es la que vale) y su acceso no pasa por la lista de espera.
//
// El orden es el del layout de `(product)`: sesión → actor → gates. Se lee
// vivo de la base en cada llamada, nunca de la sesión, fail-closed.

export type ConnectGate =
  | { kind: "ok"; actor: Actor }
  /** Sesión firmada contra un user que ya no existe: solo se arregla en `/login`. */
  | { kind: "not_authenticated" }
  /** El padre está en la lista de espera. */
  | { kind: "waitlisted" }
  /**
   * El padre no confirmó su correo: `/pending`, que le pide confirmarlo. Sin
   * suscripción ya no se rebota a nadie: está en el plan Free (ADR 0022).
   */
  | { kind: "email_unverified" }
  /**
   * El cliente no puede conectar: su fila sigue `pending` o el padre no tiene
   * suscripción activa. Nunca `/billing` —no ve precios—: vuelve a
   * `/connections`, donde el layout le muestra la cuenta restringida.
   */
  | { kind: "client_restricted" }

export async function resolveConnectGate(userId: string): Promise<ConnectGate> {
  const resolution = await resolveActorByUserId(userId)
  if (resolution.kind === "unknown_user") return { kind: "not_authenticated" }
  if (resolution.kind === "client_pending") return { kind: "client_restricted" }

  const { actor } = resolution
  if (isClientActor(actor)) {
    // El cliente salta la lista de espera —su acceso lo decidió el padre al
    // invitarlo— y su gate de suscripción es el del padre.
    if (!(await hasActiveSubscription(actor.tenantId))) {
      return { kind: "client_restricted" }
    }
    return { kind: "ok", actor }
  }

  if (await isUserWaitlisted(actor.userId)) return { kind: "waitlisted" }
  if (await needsEmailVerification(actor.userId)) {
    return { kind: "email_unverified" }
  }
  return { kind: "ok", actor }
}

// A dónde rebota una ruta por cada gate cerrado. Está acá y no repetido en
// cada `route.ts` para que un cliente nunca termine en `/billing` por una ruta
// que alguien olvidó actualizar.
export const CONNECT_GATE_REDIRECT: Record<
  Exclude<ConnectGate["kind"], "ok">,
  string
> = {
  not_authenticated: "/login",
  waitlisted: "/pending",
  email_unverified: "/pending",
  client_restricted: "/connections",
}

// Con qué motivo se registra el descarte en el log de cada ruta. El cliente
// restringido se registra como `no_active_subscription`: es lo que pasó del
// lado del padre, y el catálogo de motivos es cerrado.
export const CONNECT_GATE_LOG_REASON: Record<
  Exclude<ConnectGate["kind"], "ok">,
  LogReason
> = {
  not_authenticated: "not_authenticated",
  waitlisted: "waitlisted",
  email_unverified: "email_unverified",
  client_restricted: "no_active_subscription",
}

// El texto con el que una server action (o el cierre de WhatsApp, que
// responde JSON) explica un gate cerrado. Al cliente restringido no se le
// nombra la suscripción: es del padre.
export function connectGateError(
  gate: Exclude<ConnectGate, { kind: "ok" }>,
  t: AppDict
): string {
  switch (gate.kind) {
    case "not_authenticated":
      return t.actions.notSignedIn
    case "waitlisted":
      return t.actions.waitlisted
    case "email_unverified":
      return t.actions.emailUnverified
    case "client_restricted":
      return t.clientLimits.accessRestricted
  }
}
