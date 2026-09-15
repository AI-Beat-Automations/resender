// Canal de correo transaccional (CONTEXT.md → [Canal de correo]). Sale por
// `fetch` directo contra la API de Resend, **sin SDK**, por dos razones:
//
//   1. El bundle del Worker es el único muro duro del proyecto
//      (`scripts/check-bundle-size.mjs` avisa a 6,5 MB y falla a 8), y el único
//      SDK que la app tiene —Stripe— necesitó un `httpClient` custom para no
//      reventar en Workers.
//   2. El patrón de salida HTTP ya existe seis veces en `lib/outbound/*`; este
//      módulo copia la forma de `lib/outbound/meta-send.ts`.
//
// **Nunca lanza**, y eso no es estilo: Better Auth envuelve `sendResetPassword`
// en su propio `try/catch` y se traga la excepción con su logger. Devolver un
// `Result` y loguearlo nosotros es la única forma de que un fallo de envío no
// termine en silencio (`lib/observability/logger.ts`).

const RESEND_ENDPOINT = "https://api.resend.com/emails"

// Buzón humano al que van a parar los "yo no pedí esto". Va en el payload y no
// en la plantilla: el payload tiene precedencia.
export const REPLY_TO = "info@resender.dev"

export type SendEmailResult = {
  ok: boolean
  status: number
  // `error`: mensaje crudo de Resend o del transporte. `reason`: motivo
  // estable, el que va al log.
  error: string | null
  reason: "not_configured" | "http_error" | "network_error" | null
}

export type TemplateEmail = {
  to: string
  subject: string
  templateId: string
  // Las variables de la plantilla, ya traducidas. La sintaxis de Resend es
  // `{{{MAYUSCULAS}}}` (triple llave) y **no admite condicionales ni bucles**:
  // por eso el idioma se resuelve acá y no dentro de la plantilla.
  variables: Record<string, string>
}

export async function sendTemplateEmail(
  input: TemplateEmail
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  // Sin la key no se lanza: `next dev` y vitest corren sin secretos a
  // propósito, y tirar acá dejaría el login local sin poder pedir un enlace.
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      error: "RESEND_API_KEY is not set",
      reason: "not_configured",
    }
  }

  const from = process.env.EMAIL_FROM
  if (!from) {
    return {
      ok: false,
      status: 0,
      error: "EMAIL_FROM is not set",
      reason: "not_configured",
    }
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
      // ⚠️ Con `template` en el payload la API **rechaza `html`, `text` y
      // `react`**: mandar un `text` "por las dudas" no degrada, devuelve error
      // de validación y no se envía nada. La consecuencia asumida —correo
      // solo-HTML, que puntúa peor en filtros de spam— está en el issue #93.
      body: JSON.stringify({
        from,
        to: [input.to],
        reply_to: REPLY_TO,
        // El asunto va en el payload y no en la plantilla: así sale del
        // diccionario como el resto del copy (ADR 0006), y no depende de si
        // las variables interpolan en el asunto, que Resend no documenta.
        subject: input.subject,
        template: { id: input.templateId, variables: input.variables },
      }),
    })

    if (response.ok) {
      return { ok: true, status: response.status, error: null, reason: null }
    }

    const data = await response.json().catch(() => null)
    return {
      ok: false,
      status: response.status,
      error:
        extractResendError(data) ?? `Resend returned HTTP ${response.status}`,
      reason: "http_error",
    }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : "Resend request failed",
      reason: "network_error",
    }
  }
}

function extractResendError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const message = (data as Record<string, unknown>).message
  if (typeof message === "string" && message.trim()) return message.trim()
  const error = (data as Record<string, unknown>).error
  if (error && typeof error === "object") {
    const nested = (error as Record<string, unknown>).message
    if (typeof nested === "string" && nested.trim()) return nested.trim()
  }
  return null
}
