"use client"

import { useActionState, useId, useState } from "react"
import { Check, ChevronDown, LoaderCircle, TriangleAlert } from "lucide-react"

import { getDictionary, type Locale } from "@/content/i18n"
import type { WaitlistFormState } from "@/features/waitlist/actions"
import {
  HEARD_FROM_KEYS,
  HEARD_FROM_OTHER_MAX_LENGTH,
  type WaitlistSource,
} from "@/lib/waitlist/validation"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"

// La acción llega como prop desde el componente servidor (convención del repo,
// ver `features/auth/ui/login-view.tsx`): el cliente solo importa el tipo, así
// que este archivo no arrastra el módulo `"use server"` al bundle.
type WaitlistAction = (
  state: WaitlistFormState,
  formData: FormData
) => Promise<WaitlistFormState>

type WaitlistFormProps = {
  lang: Locale
  source: WaitlistSource
  action: WaitlistAction
  className?: string
}

// Clases del `<select>` nativo, calcadas de `packages/ui/src/components/input`:
// la ADR 0007 no agrega componentes nuevos a `packages/ui` por un solo
// formulario, así que se reusan los mismos tokens en vez de un `Select` propio.
const CONTROL_CLASS =
  "h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive"

export function WaitlistForm({
  lang,
  source,
  action,
  className,
}: WaitlistFormProps) {
  const [state, formAction, pending] = useActionState(action, {})
  // El texto libre solo se pide con `other`. Es estado local y no derivado del
  // servidor: tiene que aparecer mientras se completa el formulario, sin
  // esperar un round-trip.
  const [heardFrom, setHeardFrom] = useState("")
  const t = getDictionary(lang).waitlist.form
  const hasError = Boolean(state.error)
  const id = useId()
  const fieldId = (name: string) => `${id}-${name}`

  return (
    // El formulario se dibuja siempre sobre su propia superficie clara
    // (`bg-card`) en vez de heredar el fondo de quien lo monta. Vive en dos
    // sitios con fondos opuestos —la sección `bg-foreground text-background`
    // del cierre de la landing y el fondo normal de `/waitlist`— y una variante
    // por fondo obligaría a duplicar los tokens de cada control. Con la tarjeta,
    // `border-input`, `bg-background` y `text-muted-foreground` significan lo
    // mismo en los dos casos, y sobre el cierre oscuro además queda claro que es
    // el camino secundario y no el CTA primario (ADR 0007).
    <div
      className={cn(
        "mx-auto w-full max-w-md rounded-xl bg-card p-6 text-left text-card-foreground shadow-[var(--ring-hairline),var(--shadow-sm)]",
        className
      )}
    >
      <p className="font-heading text-lg font-bold tracking-tight">{t.title}</p>

      {state.success ? (
        // Tras el alta el formulario desaparece: dejarlo pintado invitaría a
        // enviarlo otra vez, y el segundo envío no cambia nada (el éxito es
        // idempotente).
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-success-soft-border bg-success-soft px-3 py-2.5 text-[13px] text-success-soft-foreground">
          <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t.success}
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-[13.5px]/[1.6] text-muted-foreground">
            {t.subtitle}
          </p>
          <form
            action={formAction}
            className="relative mt-5 flex flex-col gap-3.5"
          >
            {/* El server action no ve el pathname: el idioma y el origen viajan
                en campos ocultos. El `source` igual lo revalida el servidor
                contra un conjunto cerrado, porque este input es editable. */}
            <input type="hidden" name="locale" value={lang} />
            <input type="hidden" name="source" value={source} />

            {/* Campo trampa. No es `type="hidden"` a propósito: los bots
                ignoran los ocultos y completan los visibles, así que se oculta
                con CSS y se saca del foco y del árbol de accesibilidad para que
                una persona nunca lo vea ni lo tabule.
                El nombre NO es `company` ni ningún otro token que el autofill
                del navegador o un gestor de contraseñas reconozca: si lo
                rellenaran solos, la persona vería la pantalla de éxito y su
                correo no se guardaría — perder un alta en silencio es
                exactamente lo que esta entrega no puede permitirse. */}
            <div className="absolute top-0 -left-[9999px] size-0 overflow-hidden">
              {/* Literal y no diccionario: no es copy de producto, nadie lo
                  lee nunca. Está solo para que el campo le resulte creíble al
                  bot que rellena el formulario a ciegas. */}
              <label htmlFor={fieldId("nickname2")} aria-hidden>
                Nickname
              </label>
              <input
                id={fieldId("nickname2")}
                name="nickname2"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                aria-hidden
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={fieldId("email")}>{t.emailLabel}</Label>
              <Input
                id={fieldId("email")}
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={pending}
                aria-invalid={hasError}
                placeholder={t.emailPlaceholder}
                className="w-full"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={fieldId("heardFrom")}>{t.heardFromLabel}</Label>
              <div className="relative">
                <select
                  id={fieldId("heardFrom")}
                  name="heardFrom"
                  required
                  disabled={pending}
                  aria-invalid={hasError}
                  value={heardFrom}
                  onChange={(event) => setHeardFrom(event.target.value)}
                  className={cn(CONTROL_CLASS, "pr-9")}
                >
                  {/* Placeholder no seleccionable: sin él el navegador elegiría
                      la primera opción real y el dato de atribución quedaría
                      falseado por defecto. */}
                  <option value="" disabled>
                    {t.heardFromPlaceholder}
                  </option>
                  {/* Se itera `HEARD_FROM_KEYS` y no las claves del diccionario:
                      el orden de un objeto no es contrato, el del array sí. */}
                  {HEARD_FROM_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {t.heardFromOptions[key]}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>
            </div>

            {heardFrom === "other" ? (
              <div className="grid gap-2">
                <Label htmlFor={fieldId("heardFromOther")}>
                  {t.heardFromOtherLabel}
                </Label>
                <Input
                  id={fieldId("heardFromOther")}
                  name="heardFromOther"
                  type="text"
                  required
                  maxLength={HEARD_FROM_OTHER_MAX_LENGTH}
                  disabled={pending}
                  aria-invalid={hasError}
                  placeholder={t.heardFromOtherPlaceholder}
                  className="w-full"
                />
              </div>
            ) : null}

            {/* Consentimiento bloqueante (ADR 0007): sin marcarlo no se envía.
                Una fila sin consentimiento sería una fila a la que no se le
                puede escribir. El `required` es la primera barrera; el servidor
                lo vuelve a exigir. */}
            <Label
              htmlFor={fieldId("consent")}
              className="flex items-start gap-2.5 text-[12.5px]/[1.6] font-normal text-muted-foreground"
            >
              <input
                id={fieldId("consent")}
                name="consent"
                type="checkbox"
                required
                disabled={pending}
                className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
              />
              {t.consent}
            </Label>

            {state.error ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive-soft-border bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive-soft-foreground"
              >
                <TriangleAlert
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-hidden
                />
                {state.error}
              </p>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending}
            >
              {pending ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  {t.processing}
                </>
              ) : (
                t.submit
              )}
            </Button>
          </form>
        </>
      )}
    </div>
  )
}
