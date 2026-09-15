import { getDictionary, type Locale } from "@/content/i18n"
import { fmt } from "@/content/i18n/app/format"

import { sendTemplateEmail, type SendEmailResult } from "./send-email"

// El correo de [Verificacion de correo] (issue #98): el que sale en el alta
// con contraseña pidiendo confirmar la dirección. Molde exacto de
// `password-reset-email.ts`: constructor puro acá, las palabras en el
// diccionario (ADR 0006), la maqueta como plantilla en Resend (id en
// `RESEND_TEMPLATE_VERIFY_EMAIL`) y la copia del HTML versionada en
// `docs/email/verify-email.html`. **Si alguien cambia el diseño en el
// dashboard tiene que actualizar ese archivo también.**
//
// Seco y con un solo trabajo, sin explicar el gate ni vender nada: llega en el
// mismo segundo que el alta y lo único que tiene que ganar es el clic.

/** Función pura: es el seam testeable, sin `fetch` adentro. */
export function verifyEmailVariables(
  locale: Locale,
  input: { name: string; verifyUrl: string }
): Record<string, string> {
  const t = getDictionary(locale).auth.verifyEmail
  return {
    PREHEADER: t.preheader,
    // `{name}` es el de la cuenta. La plantilla de Resend no interpola nada
    // por su cuenta, así que el nombre entra ya resuelto.
    GREETING: fmt(t.greeting, { name: input.name }),
    INTRO: t.intro,
    CTA_LABEL: t.ctaLabel,
    // La única variable sin `fallback_value` en la plantilla: un enlace de
    // reserva es peor que un fallo, y acá se quiere que reviente ruidosamente
    // y aparezca en el log.
    VERIFY_URL: input.verifyUrl,
    EXPIRY_NOTE: t.expiryNote,
    FALLBACK_LABEL: t.fallbackLabel,
    // **No es relleno**: «si no creaste esta cuenta, ignora este mensaje» es
    // lo que evita que alguien confirme una cuenta que registró otro con su
    // dirección (Further Notes del #98).
    IGNORE_NOTE: t.ignoreNote,
    FOOTER_NOTE: t.footerNote,
  }
}

export function verifyEmailSubject(locale: Locale): string {
  return getDictionary(locale).auth.verifyEmail.subject
}

export async function sendVerifyEmail(input: {
  to: string
  locale: Locale
  name: string
  verifyUrl: string
}): Promise<SendEmailResult> {
  const templateId = process.env.RESEND_TEMPLATE_VERIFY_EMAIL
  if (!templateId) {
    return {
      ok: false,
      status: 0,
      error: "RESEND_TEMPLATE_VERIFY_EMAIL is not set",
      reason: "not_configured",
    }
  }

  return sendTemplateEmail({
    to: input.to,
    subject: verifyEmailSubject(input.locale),
    templateId,
    variables: verifyEmailVariables(input.locale, {
      name: input.name,
      verifyUrl: input.verifyUrl,
    }),
  })
}
