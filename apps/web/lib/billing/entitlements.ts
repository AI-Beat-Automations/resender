import { getPlanByLookupKey, type PlanLimits } from "./plans"

// Módulo puro de entitlements (ADR 0003). Sin base de datos, sin red: recibe
// valores planos (plan, período, consumo, páginas activas, resultado de Meta) y
// devuelve decisiones. Los route handlers, la ingesta del webhook, las server
// actions y la UI son llamadores delgados de estas funciones.

export type EntitlementBlockCode =
  | "quota_exceeded"
  | "page_limit_exceeded"
  | "plan_unavailable"

export type EntitlementBlock = {
  code: EntitlementBlockCode
  // Status HTTP del contrato de la API pública (ADR 0003): 402 se arregla
  // pagando, 403 se arregla desconectando páginas.
  status: 402 | 403
  message: string
}

export type QuotaNoticeLevel = "none" | "warning" | "restricted"

export type QuotaNotice = {
  level: QuotaNoticeLevel
  usage: number
  limit: number | null
  // 0..1 contra el límite del plan; null si no se pudo resolver el plan.
  ratio: number | null
}

export type EntitlementInput = {
  // `subscriptions.price_lookup_key` replicado del webhook de Stripe.
  priceLookupKey: string | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  now: Date
  // Consumo ya contabilizado del período vigente.
  usage: number
  // Páginas del tenant en estado `active`.
  activePageCount: number
}

export type TenantEntitlement = {
  limits: PlanLimits | null
  // Clave del contador de uso del período vigente; null si no hay período
  // conocido (fail-closed).
  periodStart: Date | null
  usage: number
  activePageCount: number
  // null = cuenta operativa. Cualquier otro valor = cuenta restringida.
  block: EntitlementBlock | null
  notice: QuotaNotice
}

// A partir de este porcentaje del consumo aparece la barra de alerta global
// del dashboard (ADR 0003).
export const QUOTA_WARNING_RATIO = 0.8

// Un `price_lookup_key` desconocido es fail-closed: sin límites resueltos no
// se deja pasar nada, para no regalar uso ilimitado por un price mal
// configurado en Stripe.
export function resolvePlanLimits(
  priceLookupKey: string | null | undefined
): PlanLimits | null {
  if (!priceLookupKey) return null
  return getPlanByLookupKey(priceLookupKey)?.limits ?? null
}

// La ventana de cuota es el período de facturación de Stripe, no el mes
// calendario. Sin `current_period_start` no hay ventana; con un período ya
// vencido tampoco (el webhook de renovación todavía no llegó y contar contra
// una ventana cerrada sería inventarla).
export function resolveQuotaPeriodStart(input: {
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  now: Date
}): Date | null {
  const { currentPeriodStart, currentPeriodEnd, now } = input
  if (!currentPeriodStart) return null
  if (currentPeriodEnd && currentPeriodEnd.getTime() <= now.getTime()) {
    return null
  }
  return currentPeriodStart
}

// Punto único de decisión. Precedencia de las dos causas de restricción: el
// exceso de páginas gana sobre la cuota agotada, porque es la única que el
// usuario puede resolver sin pagar — mandarlo a subir de plan cuando le basta
// con desconectar una página lo hace pagar de más.
export function evaluateEntitlement(
  input: EntitlementInput
): TenantEntitlement {
  const limits = resolvePlanLimits(input.priceLookupKey)
  const periodStart = resolveQuotaPeriodStart(input)
  const usage = input.usage
  const activePageCount = input.activePageCount

  const base = { limits, periodStart, usage, activePageCount }

  if (!limits) {
    return {
      ...base,
      block: {
        code: "plan_unavailable",
        status: 403,
        message:
          "We couldn't resolve the limits of your plan. Contact support at info@resender.dev.",
      },
      notice: { level: "restricted", usage, limit: null, ratio: null },
    }
  }

  const notice = resolveQuotaNotice({ usage, limit: limits.messagesPerPeriod })

  if (!periodStart) {
    return {
      ...base,
      block: {
        code: "plan_unavailable",
        status: 403,
        message:
          "We couldn't resolve your current billing period. Contact support at info@resender.dev.",
      },
      notice: { ...notice, level: "restricted" },
    }
  }

  if (activePageCount > limits.maxPages) {
    return {
      ...base,
      block: {
        code: "page_limit_exceeded",
        status: 403,
        message: `Your plan allows ${limits.maxPages} connected Pages and you have ${activePageCount}. Disconnect Pages in Connections to resume sending.`,
      },
      notice: { ...notice, level: "restricted" },
    }
  }

  if (usage >= limits.messagesPerPeriod) {
    return {
      ...base,
      block: {
        code: "quota_exceeded",
        status: 402,
        message: `You used the ${limits.messagesPerPeriod} messages of your plan for this billing period. Upgrade your plan to resume sending.`,
      },
      notice,
    }
  }

  return { ...base, block: null, notice }
}

// Nivel del aviso de cuota: por debajo del 80% no hay barra, desde el 80%
// aparece, y al 100% el estado ya es restringido.
export function resolveQuotaNotice(input: {
  usage: number
  limit: number | null
}): QuotaNotice {
  const { usage, limit } = input
  if (!limit || limit <= 0) {
    return { level: "restricted", usage, limit, ratio: null }
  }

  const ratio = usage / limit
  const level: QuotaNoticeLevel =
    ratio >= 1
      ? "restricted"
      : ratio >= QUOTA_WARNING_RATIO
        ? "warning"
        : "none"

  return { level, usage, limit, ratio }
}

export type QuotaBarTone = "neutral" | "warning" | "destructive"

// Resultado discriminado: o hay barra con sus datos, o no la hay. `available:
// false` no es «sin límite», es «el plan no se pudo resolver», y la UI tiene
// que pintar el bloqueo con el contacto de soporte (ADR 0005).
export type QuotaBar =
  | { available: false }
  | {
      available: true
      usage: number
      limit: number
      // 0..100, clampeado: un consumo por encima del límite no desborda.
      percentage: number
      tone: QuotaBarTone
    }

// Barra de consumo de Ajustes → Suscripción (ADR 0005). Deriva el tono de
// `resolveQuotaNotice`, el mismo criterio que la franja global del dashboard:
// dos superficies, un solo umbral (ámbar >= 80%, destructivo al bloquear).
export function resolveQuotaBar(input: {
  usage: number
  limit: number | null
}): QuotaBar {
  const { usage, limit } = input
  // Sin límite resuelto no hay barra: una barra vacía sugeriría cuota libre.
  if (!limit || limit <= 0) return { available: false }

  const { level, ratio } = resolveQuotaNotice({ usage, limit })
  const percentage = Math.min(Math.max((ratio ?? 0) * 100, 0), 100)
  const tone: QuotaBarTone =
    level === "restricted"
      ? "destructive"
      : level === "warning"
        ? "warning"
        : "neutral"

  return { available: true, usage, limit, percentage, tone }
}

// Cuenta restringida: los entrantes se siguen persistiendo y contabilizando,
// pero dejan de reenviarse al webhook del cliente.
export function shouldPushInbound(entitlement: TenantEntitlement): boolean {
  return entitlement.block === null
}

export type QuotaEvent =
  | { kind: "inbound"; persisted: boolean }
  | { kind: "reply"; acceptedByMeta: boolean; idempotentReplay: boolean }

// Qué suma al contador: un entrante persistido (aunque el tenant esté
// restringido o la página no tenga webhook) y una respuesta que Meta aceptó.
// No suman: una respuesta que Meta rechazó ni un replay idempotente, que no
// llama a Meta ni inserta un mensaje nuevo.
export function countsTowardQuota(event: QuotaEvent): boolean {
  if (event.kind === "inbound") return event.persisted
  if (event.idempotentReplay) return false
  return event.acceptedByMeta
}
