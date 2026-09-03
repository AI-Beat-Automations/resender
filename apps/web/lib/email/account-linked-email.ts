import { getDictionary, type Locale } from "@/content/i18n"
import { fmt } from "@/content/i18n/app/format"

import { sendTemplateEmail, type SendEmailResult } from "./send-email"

// El aviso de [Cuenta vinculada] (issue #98): sale cuando Google se suma a una
// cuenta que **ya tenía** contraseña. Es la contrapartida de no borrar nada:
// no se le quita a nadie una forma de entrar, pero el dueño del correo se
// entera de que apareció otra. La decisión de mandarlo o no vive en
// `lib/auth/account-linked-notice.ts`; acá solo se arma.
//
// Mismo molde que `password-reset-email.ts`: plantilla en Resend (id en
// `RESEND_TEMPLATE_ACCOUNT_LINKED`), palabras en el diccionario (ADR 0006) y
// la copia del HTML en `docs/email/account-linked.html`. **Si alguien cambia
// el diseño en el dashboard tiene que actualizar ese archivo también.**
//
// El «si no fuiste tú» lleva a `/forgot-password` y no a un buzón de soporte:
// la [Recuperacion de password] ya revoca todas las sesiones, así que le da a
// la víctima autoservicio para expulsar al atacante sin esperar a nadie.

/** Función pura: es el seam testeable, sin `fetch` adentro. */
export function accountLinkedVariables(
  locale: Locale,
  input: { googleEmail: string; forgotPasswordUrl: string }
): Record<string, string> {
  const t = getDictionary(locale).auth.accountLinkedEmail
  return {
    PREHEADER: t.preheader,
    HEADING: t.heading,
    // La dirección de Google entra ya interpolada: Resend no interpola nada
    // por su cuenta.
    INTRO: fmt(t.intro, { googleEmail: input.googleEmail }),
    BODY: t.body,
    WARNING_LABEL: t.warningLabel,
    CTA_LABEL: t.ctaLabel,
    // La única variable sin `fallback_value` en la plantilla: un enlace de
    // reserva es peor que un fallo, y acá se quiere que reviente ruidosamente
    // y aparezca en el log.
    FORGOT_URL: input.forgotPasswordUrl,
    FOOTER_NOTE: t.footerNote,
  }
}

export function accountLinkedSubject(locale: Locale): string {
  return getDictionary(locale).auth.accountLinkedEmail.subject
}

export async function sendAccountLinkedEmail(input: {
  to: string
  locale: Locale
  googleEmail: string
  forgotPasswordUrl: string
}): Promise<SendEmailResult> {
  const templateId = process.env.RESEND_TEMPLATE_ACCOUNT_LINKED
  if (!templateId) {
    return {
      ok: false,
      status: 0,
      error: "RESEND_TEMPLATE_ACCOUNT_LINKED is not set",
      reason: "not_configured",
    }
  }

  return sendTemplateEmail({
    to: input.to,
    subject: accountLinkedSubject(input.locale),
    templateId,
    variables: accountLinkedVariables(input.locale, {
      googleEmail: input.googleEmail,
      forgotPasswordUrl: input.forgotPasswordUrl,
    }),
  })
}
