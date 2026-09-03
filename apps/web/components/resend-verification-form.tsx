"use client"

import { useActionState } from "react"
import { Check, LoaderCircle, TriangleAlert } from "lucide-react"

import type { Locale } from "@/content/i18n"
import { Button } from "@workspace/ui/components/button"

// El estado de `resendVerificationEmailAction` (`features/auth/actions`),
// escrito acá estructuralmente y no importado: `components/` no importa de
// `features/`, y la forma es la misma que la de `forgotPasswordAction`.
type ResendState = {
  error?: string
  sent?: boolean
}

type ResendAction = (
  state: ResendState,
  formData: FormData
) => Promise<ResendState>

// Botón de «Reenviar confirmación» para las pantallas **con sesión**: el
// bloque de `/pending` y el panel «Cómo entras a Resender» de Settings. No
// pide correo —la acción usa el de la sesión e ignora el del formulario— y
// tras enviar muestra el «listo».
//
// Vive en `components/` y no en `features/auth/ui` por el mismo motivo que
// `SignOutForm`: lo consumen dos slices (`app/pending` y `features/account`),
// y `features/account` no puede importar de `features/auth`. La acción llega
// por prop desde la página, que es la capa que compone.
//
// El texto llega por props y no por `useAppDict()`: `/pending` y Settings ya
// tienen el `AppDict` resuelto en el servidor y así el componente no depende
// del provider del producto, que `/pending` —fuera de `(product)`— no tiene.
export function ResendVerificationForm({
  action,
  lang,
  label,
  sentLabel,
  pendingLabel,
  variant = "outline",
  size = "default",
  className,
}: {
  action: ResendAction
  lang: Locale
  label: string
  sentLabel: string
  /** Sin él, el botón deshabilitado conserva su etiqueta. */
  pendingLabel?: string
  variant?: "outline" | "default" | "secondary" | "ghost"
  size?: "default" | "sm" | "lg"
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, {})

  if (state.sent) {
    return (
      <p
        className={className}
        role="status"
        aria-live="polite"
        data-slot="resend-sent"
      >
        <span className="inline-flex items-center gap-1.5 text-[13px] text-success-soft-foreground">
          <Check className="size-3.5 shrink-0" aria-hidden />
          {sentLabel}
        </span>
      </p>
    )
  }

  return (
    <form action={formAction} className={className}>
      {/* El server action no ve el pathname: el idioma va en un input oculto,
          igual que en `AuthForm`. Solo lo usa para el 429 del rate limit. */}
      <input type="hidden" name="locale" value={lang} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant={variant} size={size} disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {pendingLabel ?? label}
            </>
          ) : (
            label
          )}
        </Button>
        {state.error ? (
          <span
            role="alert"
            className="inline-flex items-center gap-1.5 text-[13px] text-destructive"
          >
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  )
}
