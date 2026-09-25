import { resolveEmailLocale } from "@/lib/auth/email-locale"
import { sendMetaFreeTierEmail } from "@/lib/email/meta-free-tier-email"
import { accountFields, describeError, log } from "@/lib/observability/logger"
import type { ConnectedPageRecord } from "@/lib/pages/page-registry"

import { META_WHATSAPP_PRICING_URL } from "./whatsapp-billing-links"
import {
  META_FREE_SERVICE_MESSAGES_PER_MONTH,
  metaFreeTierPeriod,
  reachedAlertThresholds,
  type MetaFreeTierThreshold,
} from "./whatsapp-free-tier"
import {
  claimMetaFreeTierAlert,
  countMetaServiceUsage,
  getTenantOwnerEmail,
  releaseMetaFreeTierAlert,
} from "./whatsapp-free-tier-usage"

// El correo del [Cupo gratis de Meta] al 80 % y al 100 % (issue #171). Lo
// dispara la ingesta con cada acuse `delivered` de servicio que guardó su
// cobro: es el único momento en que el conteo puede subir.
//
// **Una vez por número, mes y umbral**, y la garantía la da la base: el umbral
// se reclama en `meta_free_tier_alerts` antes de mandar, y solo manda quien
// insertó la fila. Si el envío falla, el reclamo se suelta y el próximo acuse
// lo reintenta.
//
// Si al mirar ya se alcanzaron los dos umbrales —un número que ya iba por
// 1.050 cuando esto se desplegó—, se reclaman los dos pero sale **un solo**
// correo, el del 100 %: el del 80 % a esa altura ya no dice nada nuevo.
//
// Va al dueño del tenant (el padre), también por los números de sus clientes:
// es quien tiene correo seguro y quien responde por la cuenta. El idioma se
// resuelve como en los demás correos; acá no hay request ni cookie, así que
// sale en `es`, el idioma por defecto ([Preferencia de idioma]).
//
// **Nunca lanza**: corre dentro de la ingesta de acuses, y un correo que no
// sale no puede tirar el resto del lote.

type AlertPage = Pick<
  ConnectedPageRecord,
  | "id"
  | "tenantId"
  | "channel"
  | "metaPageId"
  | "username"
  | "name"
  | "whatsappPhoneE164"
>

export async function notifyMetaFreeTierThresholds(
  page: AlertPage,
  deliveredAt: Date
): Promise<void> {
  if (page.channel !== "whatsapp") return

  try {
    const period = metaFreeTierPeriod(deliveredAt)
    const usage = await countMetaServiceUsage([page.id], period)
    const serviceCount = usage.get(page.id)?.serviceCount ?? 0
    const reached = reachedAlertThresholds(serviceCount)
    if (reached.length === 0) return

    // Mismo criterio que el aviso de [Cuenta vinculada]: sin origen no hay
    // enlace que mandar, y no se reclama nada para que salga cuando lo haya.
    const base = process.env.BETTER_AUTH_URL
    if (!base) {
      log({
        entrypoint: "after",
        action: "email_send",
        outcome: "failed",
        reason: "not_configured",
        ...accountFields(page),
        errorMessage:
          "BETTER_AUTH_URL is not set: no origin for the connections link",
      })
      return
    }

    const claimed: MetaFreeTierThreshold[] = []
    for (const threshold of reached) {
      if (
        await claimMetaFreeTierAlert({
          connectedPageId: page.id,
          periodStart: period.start,
          threshold,
        })
      ) {
        claimed.push(threshold)
      }
    }
    // El más alto de los recién reclamados; los umbrales vienen en orden.
    const threshold = claimed[claimed.length - 1]
    if (threshold === undefined) return

    const release = () =>
      Promise.all(
        claimed.map((claimedThreshold) =>
          releaseMetaFreeTierAlert({
            connectedPageId: page.id,
            periodStart: period.start,
            threshold: claimedThreshold,
          })
        )
      )

    const to = await getTenantOwnerEmail(page.tenantId)
    if (!to) {
      await release()
      log({
        entrypoint: "after",
        action: "email_send",
        outcome: "failed",
        reason: "internal_error",
        ...accountFields(page),
        errorMessage: "meta free tier alert for a tenant without owner email",
      })
      return
    }

    const result = await sendMetaFreeTierEmail({
      to,
      locale: await resolveEmailLocale(),
      threshold,
      phone: page.whatsappPhoneE164 ?? page.name,
      used: serviceCount,
      limit: META_FREE_SERVICE_MESSAGES_PER_MONTH,
      connectionsUrl: `${base}/connections`,
      pricingUrl: META_WHATSAPP_PRICING_URL,
    })

    // `sendTemplateEmail` nunca lanza: el fallo llega como dato. Se suelta el
    // reclamo para que el próximo acuse lo reintente, y se registra.
    if (!result.ok) {
      await release()
      log({
        entrypoint: "after",
        action: "email_send",
        outcome: "failed",
        reason: result.reason ?? "internal_error",
        status: result.status,
        ...accountFields(page),
        errorMessage: result.error ?? undefined,
      })
    }
  } catch (error) {
    log({
      entrypoint: "after",
      action: "email_send",
      outcome: "failed",
      reason: "internal_error",
      ...accountFields(page),
      errorMessage: describeError(error),
    })
  }
}
