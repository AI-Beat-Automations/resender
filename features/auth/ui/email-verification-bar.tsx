"use client"

import { useActionState, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Check, MailCheck, MailWarning } from "lucide-react"

import { fmt } from "@/content/i18n/app"
import { useAppI18n } from "@/content/i18n/app/provider"
import { resendVerificationEmailAction } from "@/features/auth/actions"
import { classifyVerificationError } from "@/lib/auth/oauth-errors"

// Cuánto queda deshabilitado «Reenviar correo» tras un envío. Es cortesía de
// interfaz, no la defensa: el rate limit por IP de la acción sigue mandando.
const RESEND_COOLDOWN_MS = 60_000

// Barra de [Verificacion de correo], debajo del header y encima de la franja
// de cuota. Reemplaza al muro de `/pending`: la cuenta sin confirmar entra al
// producto y esta barra se lo recuerda en cada pantalla, **sin botón de
// cerrar**, hasta que `email_verified` sea verdadero (leído vivo en el
// layout, que es quien decide si se monta).
//
// Es cliente por dos cosas: el `?error=` / `?verify=` con que vuelve el
// [Enlace de verificacion] (el layout no ve el querystring) y el estado del
// reenvío.
export function EmailVerificationBar({
  verified,
  email,
  connectBlocked,
}: {
  verified: boolean
  email: string
  /** Free sin confirmar: el connect gate le cierra las redes. */
  connectBlocked: boolean
}) {
  const { t } = useAppI18n()
  const params = useSearchParams()
  const copy = t.emailVerification

  if (verified) {
    // Aterrizaje del enlace ya confirmado: una franja verde en lugar del
    // toast que el producto no tiene. Se va con la siguiente navegación.
    if (params.get("verify") !== "1" || params.get("error")) return null
    return (
      <div
        role="status"
        className={`${barClassName} border-success-soft-border bg-success-soft text-success-soft-foreground`}
      >
        <MailCheck className="hidden size-[15px] shrink-0 sm:block" aria-hidden />
        <p className="flex-1">{copy.verified}</p>
      </div>
    )
  }

  const linkExpired =
    classifyVerificationError(params.get("error") ?? undefined) ===
    "link_expired"

  return (
    <div
      className={`${barClassName} border-info-soft-border bg-info-soft text-info-soft-foreground`}
    >
      <MailWarning className="hidden size-[15px] shrink-0 sm:block" aria-hidden />
      <p className="flex-1">
        <span className="font-semibold">
          {linkExpired ? copy.linkExpired : copy.title}
        </span>{" "}
        {fmt(connectBlocked ? copy.bodyConnect : copy.body, { email })}
      </p>
      <ResendLink />
    </div>
  )
}

function ResendLink() {
  const { lang, t } = useAppI18n()
  const copy = t.emailVerification
  const [state, formAction, pending] = useActionState(
    resendVerificationEmailAction,
    {}
  )
  // Cada respuesta es un objeto nuevo: la espera dura mientras la última no
  // haya vencido, aunque dos envíos seguidos devuelvan lo mismo.
  const [expired, setExpired] = useState<typeof state | null>(null)
  const coolingDown = Boolean(state.sent) && expired !== state

  useEffect(() => {
    if (!state.sent) return
    const timer = setTimeout(() => setExpired(state), RESEND_COOLDOWN_MS)
    return () => clearTimeout(timer)
  }, [state])

  return (
    <form action={formAction} className="flex items-center gap-2">
      {/* Solo lo usa la acción para el 429 del rate limit, como en
          `ResendVerificationForm`. */}
      <input type="hidden" name="locale" value={lang} />
      {state.error && !coolingDown ? (
        <span role="alert" className="text-destructive">
          {state.error}
        </span>
      ) : null}
      {coolingDown ? (
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1 font-medium whitespace-nowrap"
        >
          <Check className="size-3.5 shrink-0" aria-hidden />
          {copy.sent}
        </span>
      ) : (
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer font-medium whitespace-nowrap underline underline-offset-[3px] disabled:cursor-default disabled:opacity-60"
        >
          {pending ? copy.sending : copy.resend}
        </button>
      )}
    </form>
  )
}

// Misma franja que `QuotaNoticeBar` (mock `1e`): 10/24 de padding, 13px.
const barClassName =
  "flex flex-col gap-1 border-b px-6 py-2.5 text-[13px] leading-[1.5] sm:flex-row sm:items-center sm:gap-3"
