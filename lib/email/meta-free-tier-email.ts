import { getAppDictionary } from "@/content/i18n/app"
import { fmt } from "@/content/i18n/app/format"
import type { Locale } from "@/content/i18n"
import type { MetaFreeTierThreshold } from "@/lib/meta/whatsapp-free-tier"

import { sendTemplateEmail, type SendEmailResult } from "./send-email"

// El aviso del [Cupo gratis de Meta] (issue #171): le llega al dueño del tenant
// cuando un número de WhatsApp cruza el 80 % o el 100 % de sus mensajes de
// servicio gratis del mes. Una plantilla para los dos umbrales —cambian las
// palabras, no la maqueta—. La decisión de mandarlo vive en
// `lib/meta/whatsapp-free-tier-alerts.ts`; acá solo se arma.
//
// Mismo molde que `client-invitation-email.ts`: plantilla en Resend (id en
// `RESEND_TEMPLATE_META_FREE_TIER`), palabras en el diccionario del producto y
// la copia del HTML en `docs/email/meta-free-tier.html`. **Si alguien cambia
// el diseño en el dashboard tiene que actualizar ese archivo también.**

export type MetaFreeTierEmailInput = {
  threshold: MetaFreeTierThreshold
  /** Lo que el dueño reconoce del número: el E.164, o el nombre si falta. */
  phone: string
  /** Mensajes de servicio del mes al cruzar el umbral. */
  used: number
  limit: number
  connectionsUrl: string
  pricingUrl: string
}

/** Función pura: es el seam testeable, sin `fetch` adentro. */
export function metaFreeTierVariables(
  locale: Locale,
  input: MetaFreeTierEmailInput
): Record<string, string> {
  const dict = getAppDictionary(locale)
  const t = dict.metaFreeTier.email
  const number = new Intl.NumberFormat(dict.intl)
  const values = {
    phone: input.phone,
    used: number.format(input.used),
    limit: number.format(input.limit),
  }
  const full = input.threshold === 100
  return {
    PREHEADER: full ? t.preheader100 : t.preheader80,
    HEADING: full ? t.heading100 : t.heading80,
    INTRO: fmt(full ? t.intro100 : t.intro80, values),
    BODY: full ? t.body100 : t.body80,
    NOTE: t.notResenderNote,
    CTA_LABEL: t.ctaLabel,
    CONNECTIONS_URL: input.connectionsUrl,
    PRICING_LABEL: t.pricingLabel,
    PRICING_URL: input.pricingUrl,
    FOOTER_NOTE: t.footerNote,
  }
}

export function metaFreeTierSubject(
  locale: Locale,
  threshold: MetaFreeTierThreshold,
  phone: string
): string {
  const t = getAppDictionary(locale).metaFreeTier.email
  return fmt(threshold === 100 ? t.subject100 : t.subject80, { phone })
}

export async function sendMetaFreeTierEmail(
  input: MetaFreeTierEmailInput & { to: string; locale: Locale }
): Promise<SendEmailResult> {
  const templateId = process.env.RESEND_TEMPLATE_META_FREE_TIER
  if (!templateId) {
    return {
      ok: false,
      status: 0,
      error: "RESEND_TEMPLATE_META_FREE_TIER is not set",
      reason: "not_configured",
    }
  }

  return sendTemplateEmail({
    to: input.to,
    subject: metaFreeTierSubject(input.locale, input.threshold, input.phone),
    templateId,
    variables: metaFreeTierVariables(input.locale, input),
  })
}
