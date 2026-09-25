// [Cupo gratis de Meta] (ADR 0023, issue #171): cuánto lleva cada número de
// WhatsApp de sus mensajes de servicio gratis del mes. Es el consumo de
// **Meta**, que Meta le factura directo al cliente; no tiene nada que ver con
// la cuota del plan de Resender ([Mensaje contabilizado], [Período de cuota]).
//
// Solo funciones puras: el período, el estado de la barra y los umbrales del
// correo. El conteo vive en `whatsapp-free-tier-usage.ts` y el envío en
// `whatsapp-free-tier-alerts.ts`.

/**
 * Mensajes de servicio gratis por número y por mes. Lo publican varios
 * proveedores, pero la página de precios de Meta todavía no (ADR 0023): si
 * Meta publica otro número, se cambia acá y en el copy.
 */
export const META_FREE_SERVICE_MESSAGES_PER_MONTH = 1000

/** Los dos umbrales del correo, en porcentaje del cupo. */
export const META_FREE_TIER_ALERT_THRESHOLDS = [80, 100] as const
export type MetaFreeTierThreshold =
  (typeof META_FREE_TIER_ALERT_THRESHOLDS)[number]

export type MetaFreeTierPeriod = { start: Date; end: Date }

/**
 * El mes que contiene `at`, en **UTC**: `[start, end)`. Meta reinicia el cupo
 * según la zona horaria de la WABA, que todavía no guardamos; por eso la UI
 * dice «aprox.». Leerla al conectar es un seguimiento aparte.
 */
export function metaFreeTierPeriod(at: Date): MetaFreeTierPeriod {
  const year = at.getUTCFullYear()
  const month = at.getUTCMonth()
  return {
    start: new Date(Date.UTC(year, month, 1)),
    // `Date.UTC` desborda diciembre + 1 al enero del año siguiente.
    end: new Date(Date.UTC(year, month + 1, 1)),
  }
}

/** Lo que se contó de un número en un mes. */
export type MetaFreeTierUsage = {
  /** Mensajes de servicio entregados (`meta_pricing_category = 'service'`). */
  serviceCount: number
  /** De esos, cuántos marcó Meta como cobrables (`meta_billable = true`). */
  billedCount: number
}

/**
 * Los tres estados de la barra:
 * - `within`: le queda cupo, por debajo del 80 %.
 * - `near`: del 80 % hasta antes de agotarlo.
 * - `charged`: agotó el cupo; lo que sigue Meta lo cobra.
 *
 * Los cortes son los mismos del correo: la barra cambia de color cuando sale
 * el aviso.
 */
export type MetaFreeTierState = "within" | "near" | "charged"

export function resolveMetaFreeTierState(
  serviceCount: number
): MetaFreeTierState {
  const reached = reachedAlertThresholds(serviceCount)
  if (reached.includes(100)) return "charged"
  if (reached.includes(80)) return "near"
  return "within"
}

/** Los umbrales que un número ya alcanzó con `serviceCount` mensajes. */
export function reachedAlertThresholds(
  serviceCount: number
): MetaFreeTierThreshold[] {
  return META_FREE_TIER_ALERT_THRESHOLDS.filter(
    (threshold) =>
      serviceCount * 100 >= threshold * META_FREE_SERVICE_MESSAGES_PER_MONTH
  )
}

export type MetaFreeTierView = {
  state: MetaFreeTierState
  /** Gratis gastados, topado al cupo: «734 de 1.000». */
  freeUsed: number
  freeLimit: number
  /** Ancho de la barra, 0–100. */
  percent: number
  billedCount: number
}

export function buildMetaFreeTierView(
  usage: MetaFreeTierUsage
): MetaFreeTierView {
  const freeLimit = META_FREE_SERVICE_MESSAGES_PER_MONTH
  const freeUsed = Math.min(usage.serviceCount, freeLimit)
  return {
    state: resolveMetaFreeTierState(usage.serviceCount),
    freeUsed,
    freeLimit,
    percent: Math.round((freeUsed / freeLimit) * 100),
    billedCount: usage.billedCount,
  }
}
