import { getAppDictionary } from "@/content/i18n/app"
import { fmt } from "@/content/i18n/app/format"
import type { Locale } from "@/content/i18n"

import { sendTemplateEmail, type SendEmailResult } from "./send-email"

// El correo de invitación de un cliente (issue #154): el que le llega a la
// persona que el padre acaba de crear en `/clientes`. Molde exacto de
// `password-reset-email.ts`: constructor puro acá, las palabras en el
// diccionario del producto (`content/i18n/app`, como pide el ticket #155), la
// maqueta como plantilla en Resend (id en `RESEND_TEMPLATE_CLIENT_INVITATION`)
// y la copia del HTML versionada en `docs/email/client-invitation.html`. **Si
// alguien cambia el diseño en el dashboard tiene que actualizar ese archivo
// también.**
//
// El asunto lleva el nombre del padre: es lo único que le dice al cliente de
// quién viene esto, porque el remitente es Resender y no el padre.

export type ClientInvitationEmailInput = {
  /** Nombre del cliente que escribió el padre. */
  clientName: string
  /** Nombre del padre (o su correo, si no tiene nombre). */
  ownerName: string
  inviteUrl: string
}

/** Función pura: es el seam testeable, sin `fetch` adentro. */
export function clientInvitationVariables(
  locale: Locale,
  input: ClientInvitationEmailInput
): Record<string, string> {
  const t = getAppDictionary(locale).clients.invitationEmail
  return {
    PREHEADER: t.preheader,
    GREETING: fmt(t.greeting, { name: input.clientName }),
    INTRO: fmt(t.intro, { owner: input.ownerName }),
    CTA_LABEL: t.ctaLabel,
    // La única variable sin `fallback_value` en la plantilla: un enlace de
    // reserva es peor que un fallo, y acá se quiere que reviente ruidosamente
    // y aparezca en el log.
    INVITE_URL: input.inviteUrl,
    EXPIRY_NOTE: t.expiryNote,
    FALLBACK_LABEL: t.fallbackLabel,
    IGNORE_NOTE: t.ignoreNote,
    FOOTER_NOTE: t.footerNote,
  }
}

export function clientInvitationSubject(
  locale: Locale,
  ownerName: string
): string {
  return fmt(getAppDictionary(locale).clients.invitationEmail.subject, {
    owner: ownerName,
  })
}

export async function sendClientInvitationEmail(
  input: ClientInvitationEmailInput & { to: string; locale: Locale }
): Promise<SendEmailResult> {
  const templateId = process.env.RESEND_TEMPLATE_CLIENT_INVITATION
  if (!templateId) {
    return {
      ok: false,
      status: 0,
      error: "RESEND_TEMPLATE_CLIENT_INVITATION is not set",
      reason: "not_configured",
    }
  }

  return sendTemplateEmail({
    to: input.to,
    subject: clientInvitationSubject(input.locale, input.ownerName),
    templateId,
    variables: clientInvitationVariables(input.locale, input),
  })
}
