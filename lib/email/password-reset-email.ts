import { getDictionary, type Locale } from "@/content/i18n"

import { sendTemplateEmail, type SendEmailResult } from "./send-email"

// El correo de [Recuperacion de password]: el único que el [Canal de correo]
// manda hoy.
//
// La maqueta vive como plantilla en Resend (id en
// `RESEND_TEMPLATE_PASSWORD_RESET`); el HTML fuente que se pegó en el editor
// está versionado en `docs/email/password-reset.html`. **Si alguien cambia el
// diseño en el dashboard tiene que actualizar ese archivo también**, o el repo
// deja de tener copia de lo que se envía.
//
// Las palabras siguen en el diccionario del repositorio (ADR 0006) y llegan a
// la plantilla como variables: la sintaxis de Resend es `{{{MAYUSCULAS}}}` y
// no tiene condicionales, así que el idioma se resuelve acá.

/** Función pura: es el seam testeable, sin `fetch` adentro. */
export function passwordResetVariables(
  locale: Locale,
  resetUrl: string
): Record<string, string> {
  const t = getDictionary(locale).auth.resetEmail
  return {
    PREHEADER: t.preheader,
    HEADING: t.heading,
    INTRO: t.intro,
    CTA_LABEL: t.ctaLabel,
    // La única variable sin `fallback_value` en la plantilla: un enlace de
    // reserva es peor que un fallo, y acá se quiere que reviente ruidosamente
    // y aparezca en el log.
    RESET_URL: resetUrl,
    EXPIRY_NOTE: t.expiryNote,
    FALLBACK_LABEL: t.fallbackLabel,
    IGNORE_NOTE: t.ignoreNote,
    FOOTER_NOTE: t.footerNote,
  }
}

export function passwordResetSubject(locale: Locale): string {
  return getDictionary(locale).auth.resetEmail.subject
}

export async function sendPasswordResetEmail(input: {
  to: string
  locale: Locale
  resetUrl: string
}): Promise<SendEmailResult> {
  const templateId = process.env.RESEND_TEMPLATE_PASSWORD_RESET
  if (!templateId) {
    return {
      ok: false,
      status: 0,
      error: "RESEND_TEMPLATE_PASSWORD_RESET is not set",
      reason: "not_configured",
    }
  }

  return sendTemplateEmail({
    to: input.to,
    subject: passwordResetSubject(input.locale),
    templateId,
    variables: passwordResetVariables(input.locale, input.resetUrl),
  })
}
