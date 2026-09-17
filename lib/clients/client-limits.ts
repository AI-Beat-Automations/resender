import { fmt, type AppDict } from "@/content/i18n/app"
import { QUOTA_WARNING_RATIO } from "@/lib/billing/entitlements"

// Regla de cupo al conectar como cliente (issue #154, ticket 3). Módulo puro:
// sin base, sin sesión, sin red. Entradas = límites del plan del padre,
// conexiones activas del tenant, tope del cliente, conexiones activas del
// cliente; salida = veredicto más el aviso de proximidad.
//
// Se consulta desde los mismos puntos que hoy evalúan el entitlement y la
// selección de páginas: la server action de Messenger, el callback de
// Instagram y el cierre de WhatsApp. El conteo global del tenant sigue siendo
// `countActivePages` (ADR 0011): una conexión de un cliente ocupa un slot del
// plan del padre igual que una suya.

export type ClientLimitsInput = {
  /** `maxPages` del plan del padre (ADR 0011: cupo de conexiones). */
  planMaxPages: number
  /** Conexiones `active` de todo el tenant, del padre y de sus clientes. */
  tenantActiveCount: number
  /** Tope del cliente; `null` cuando el actor es el padre. */
  clientMaxConnections: number | null
  /** Conexiones `active` con el `client_account_id` del cliente. */
  clientActiveCount: number
}

export type ClientLimitVerdict =
  | "allowed"
  | "client_limit_reached"
  | "tenant_limit_reached"

export type ClientLimits = {
  verdict: ClientLimitVerdict
  /**
   * Huecos que de verdad puede usar: el menor entre lo que le queda de su tope
   * y lo que le queda al plan del padre. Nunca negativo.
   */
  remainingSlots: number
  /** Aviso de proximidad: solo cuando todavía puede conectar. */
  nearLimit: boolean
  clientMaxConnections: number | null
  clientActiveCount: number
  planMaxPages: number
  tenantActiveCount: number
}

export function evaluateClientLimits(input: ClientLimitsInput): ClientLimits {
  const tenantRemaining = Math.max(
    0,
    input.planMaxPages - input.tenantActiveCount
  )

  // El padre: la regla de siempre, sin aviso de proximidad —el suyo es el de
  // cuota, que ya existe y sí habla del plan—.
  if (input.clientMaxConnections === null) {
    return {
      verdict: tenantRemaining === 0 ? "tenant_limit_reached" : "allowed",
      remainingSlots: tenantRemaining,
      nearLimit: false,
      clientMaxConnections: null,
      clientActiveCount: input.clientActiveCount,
      planMaxPages: input.planMaxPages,
      tenantActiveCount: input.tenantActiveCount,
    }
  }

  // El tope es un máximo, no una reserva: puede ser menor que lo ya conectado
  // si el padre lo bajó. Se queda en cero, no en negativo.
  const clientRemaining = Math.max(
    0,
    input.clientMaxConnections - input.clientActiveCount
  )

  // El tope propio primero: es el límite que el cliente conoce y el que su
  // padre puede mover. El del plan es el techo de todos y corta aunque al
  // cliente le queden huecos.
  const verdict: ClientLimitVerdict =
    clientRemaining === 0
      ? "client_limit_reached"
      : tenantRemaining === 0
        ? "tenant_limit_reached"
        : "allowed"

  const ratio = input.clientActiveCount / input.clientMaxConnections
  const nearLimit =
    verdict === "allowed" &&
    input.clientActiveCount > 0 &&
    (clientRemaining === 1 || ratio >= QUOTA_WARNING_RATIO)

  return {
    verdict,
    remainingSlots: Math.min(clientRemaining, tenantRemaining),
    nearLimit,
    clientMaxConnections: input.clientMaxConnections,
    clientActiveCount: input.clientActiveCount,
    planMaxPages: input.planMaxPages,
    tenantActiveCount: input.tenantActiveCount,
  }
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

export type ClientLimitNotice = {
  level: "warning" | "blocked"
  title: string
  body: string
}

function ownerLabel(ownerName: string | null, t: AppDict): string {
  return ownerName?.trim() || t.clientLimits.ownerFallback
}

/**
 * El aviso de Conexiones para el cliente: proximidad, tope propio o límite
 * global del padre. Los tres nombran al padre y ninguno habla de planes ni de
 * precios. Para el padre devuelve `null`: su aviso es el de cuota de siempre.
 */
export function formatClientLimitNotice(
  limits: ClientLimits,
  ownerName: string | null,
  t: AppDict
): ClientLimitNotice | null {
  if (limits.clientMaxConnections === null) return null

  const owner = ownerLabel(ownerName, t)
  const values = {
    owner,
    activePageCount: limits.clientActiveCount,
    maxConnections: limits.clientMaxConnections,
  }

  if (limits.verdict === "client_limit_reached") {
    return {
      level: "blocked",
      title: t.clientLimits.reachedTitle,
      body: fmt(t.clientLimits.reachedBody, values),
    }
  }

  if (limits.verdict === "tenant_limit_reached") {
    return {
      level: "blocked",
      title: t.clientLimits.tenantReachedTitle,
      body: fmt(t.clientLimits.tenantReachedBody, values),
    }
  }

  if (limits.nearLimit) {
    return {
      level: "warning",
      title: t.clientLimits.nearTitle,
      body: fmt(t.clientLimits.nearBody, values),
    }
  }

  return null
}

/**
 * El mensaje con el que se rechaza conectar: debajo del botón en Messenger y
 * WhatsApp, y como aviso en Conexiones tras el callback de Instagram.
 */
export function formatClientConnectRejection(
  verdict: Exclude<ClientLimitVerdict, "allowed">,
  ownerName: string | null,
  t: AppDict
): string {
  const owner = ownerLabel(ownerName, t)
  return fmt(
    verdict === "client_limit_reached"
      ? t.clientLimits.rejectedOwn
      : t.clientLimits.rejectedTenant,
    { owner }
  )
}

// Los dos veredictos viajan tal cual como `reason` del querystring del
// callback de Instagram: la pantalla de Conexiones los reconoce con esto y los
// redacta con el nombre del padre, que el catálogo de `metaErrors` no tiene.
export function isClientLimitReason(
  reason: string | null | undefined
): reason is Exclude<ClientLimitVerdict, "allowed"> {
  return reason === "client_limit_reached" || reason === "tenant_limit_reached"
}
