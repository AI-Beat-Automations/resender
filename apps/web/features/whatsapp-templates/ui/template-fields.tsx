"use client"

import { useId, useState } from "react"

import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import {
  listWhatsappTemplateVariables,
  WHATSAPP_TEMPLATE_BODY_MAX_LENGTH,
  WHATSAPP_TEMPLATE_FOOTER_MAX_LENGTH,
} from "@/lib/whatsapp-templates/template-form"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"

// Los campos que comparten crear y editar: cuerpo, pie y un ejemplo por
// variable. Un solo componente porque el editor es el mismo en los dos casos
// —Meta no deja editar ni el nombre ni el idioma, que son la identidad de la
// plantilla— y duplicarlo dejaría el aviso de los ejemplos en una sola mitad.
//
// **Es cliente por una sola razón**: las casillas de ejemplo aparecen mientras
// se escribe el cuerpo. Meta exige un valor de ejemplo por cada variable y sin
// ellos el rechazo es automático y sin revisión, así que pedirlos después de
// guardar sería pedirlos tarde.
//
// La regla de qué variables tiene un cuerpo **no está acá**: vive en
// `lib/whatsapp-templates/template-form.ts` con su test. Los `.tsx` no se
// testean (Vitest corre en `node`), y el orden de esos ejemplos es justo lo que
// no se puede verificar mirando la pantalla: un cruce entre `{{1}}` y `{{2}}`
// produce una plantilla que Meta aprueba igual y que sólo se ve mal en el
// teléfono del contacto.

// Calcadas de `packages/ui/src/components/input` para el `<textarea>` nativo: la
// ADR 0007 no agrega componentes a `packages/ui` por un solo formulario.
const TEXTAREA_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive"

export function TemplateFields({
  defaultBody = "",
  defaultFooter = "",
  disabled,
}: {
  defaultBody?: string
  defaultFooter?: string
  disabled: boolean
}) {
  // El cuerpo es estado local y no derivado del servidor: las casillas de
  // ejemplo tienen que aparecer mientras se escribe, sin un round-trip.
  const [body, setBody] = useState(defaultBody)
  const t = useAppDict().templates
  const id = useId()
  const fieldId = (name: string) => `${id}-${name}`
  const variables = listWhatsappTemplateVariables(body)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor={fieldId("body")}>{t.fields.bodyLabel}</Label>
        <textarea
          id={fieldId("body")}
          name="body"
          required
          rows={4}
          disabled={disabled}
          maxLength={WHATSAPP_TEMPLATE_BODY_MAX_LENGTH}
          placeholder={t.fields.bodyPlaceholder}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className={TEXTAREA_CLASS}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12.5px] text-muted-foreground">
            {t.fields.bodyHint}
          </p>
          <p className="font-mono text-[11px] text-[var(--text-subtle)]">
            {fmt(t.fields.bodyCount, {
              count: body.length,
              max: WHATSAPP_TEMPLATE_BODY_MAX_LENGTH,
            })}
          </p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={fieldId("footer")}>{t.fields.footerLabel}</Label>
        <Input
          id={fieldId("footer")}
          name="footer"
          disabled={disabled}
          defaultValue={defaultFooter}
          maxLength={WHATSAPP_TEMPLATE_FOOTER_MAX_LENGTH}
          placeholder={t.fields.footerPlaceholder}
        />
        <p className="text-[12.5px] text-muted-foreground">
          {t.fields.footerHint}
        </p>
      </div>

      <div
        className={cn(
          "rounded-lg border border-border bg-surface-sunken p-3.5",
          variables.length === 0 && "text-muted-foreground"
        )}
      >
        <p className="text-[13.5px] font-medium">{t.fields.examplesTitle}</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {variables.length === 0
            ? t.fields.noVariables
            : t.fields.examplesBody}
        </p>
        {variables.length > 0 && (
          // Un campo por variable, **en orden de número** y no de aparición en
          // el texto: `example.body_text` es posicional. El orden lo fija
          // `listWhatsappTemplateVariables`, y `formData.getAll("example")` lo
          // conserva, así que la posición no hace falta mandarla aparte.
          <div className="mt-3 flex flex-col gap-2.5">
            {variables.map((variable) => {
              const label = fmt(t.fields.exampleLabel, {
                variable: `{{${variable}}}`,
              })

              return (
                <div key={variable} className="grid gap-1.5">
                  <Label htmlFor={fieldId(`example-${variable}`)}>
                    {label}
                  </Label>
                  <Input
                    id={fieldId(`example-${variable}`)}
                    name="example"
                    // `required` nativo: es lo que impide que un ejemplo vacío
                    // llegue al servidor sin escribir una segunda validación al
                    // lado de `parseWhatsappTemplateDraft`, que es la que decide.
                    required
                    disabled={disabled}
                    placeholder={t.fields.examplePlaceholder}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
