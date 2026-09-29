"use client"

import { useState, useTransition } from "react"
import { AlertTriangle, LoaderCircle, Pencil, Plus } from "lucide-react"

import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import {
  createTemplateAction,
  editTemplateAction,
} from "@/features/templates/actions"
import {
  TEMPLATE_BODY_MAX_CHARS,
  TEMPLATE_DRAFT_CATEGORIES,
  TEMPLATE_FOOTER_MAX_CHARS,
  validateTemplateContent,
  validateTemplateDraft,
} from "@/lib/whatsapp-templates/template-draft"
import {
  buildTemplatePreview,
  detectTemplateVariables,
  exampleFieldName,
  readTemplateContentForm,
  readTemplateDraftForm,
  templateConfirmation,
  type TemplateConfirmation,
} from "@/lib/whatsapp-templates/template-editor"
import type { WhatsappTemplateStatus } from "@/lib/whatsapp-templates/template-store"
import { cn } from "@/lib/utils"
import { Alert, AlertContent, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Los mismos tokens que `Input`, para el `<select>` y el `<textarea>` nativos
// (molde de `waitlist-form`): no hay componentes propios para un solo
// formulario.
const CONTROL_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive"

export type EditableTemplate = {
  id: string
  name: string
  language: string
  status: WhatsappTemplateStatus
  body: string | null
  /** Números fuera del alcance del actor que ya la enviaron. */
  usedByOtherNumbers: number
}

type Props =
  | { mode: "create"; phoneNumberId: string }
  | { mode: "edit"; phoneNumberId: string; template: EditableTemplate }

// El editor v1 de una [Plantilla] (issue #196): cuerpo con `{{n}}` y un
// ejemplo por variable, pie opcional, `utility` o `marketing`. Al crear se
// eligen nombre, idioma y categoría; al editar solo el contenido, porque son la
// identidad de la plantilla en Meta.
//
// Valida en el navegador con `validateTemplateDraft` / `validateTemplateContent`
// —el mismo módulo que la API— para no mostrar una confirmación de algo que el
// servidor va a rechazar; la acción vuelve a validar. Editar una aprobada, o
// una que usaron otros números, pasa por un paso de confirmación antes de
// llamar a la acción.
export function TemplateEditorDialog(props: Props) {
  const dict = useAppDict()
  const t = dict.templates
  const editing = props.mode === "edit" ? props.template : null

  const [open, setOpen] = useState(false)
  const [body, setBody] = useState(editing?.body ?? "")
  const [examples, setExamples] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  // El formulario ya validado que espera confirmación.
  const [confirming, setConfirming] = useState<{
    formData: FormData
    confirmation: TemplateConfirmation
  } | null>(null)
  const [pending, startTransition] = useTransition()

  const variables = detectTemplateVariables(body)
  const preview = body.trim() ? buildTemplatePreview(body, examples) : ""
  const idPrefix = editing ? `template-${editing.id}` : "template-new"

  function reset() {
    setBody(editing?.body ?? "")
    setExamples({})
    setError(null)
    setConfirming(null)
  }

  function onOpenChange(next: boolean) {
    if (next) reset()
    setOpen(next)
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = editing
        ? await editTemplateAction({}, formData)
        : await createTemplateAction({}, formData)
      if (result.error) {
        setError(result.error)
        setConfirming(null)
        return
      }
      setOpen(false)
    })
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    const checked = editing
      ? validateTemplateContent(readTemplateContentForm(formData))
      : validateTemplateDraft(readTemplateDraftForm(formData))
    if (!checked.ok) {
      setError(t.draftErrors[checked.code])
      return
    }
    setError(null)

    const confirmation = editing ? templateConfirmation("edit", editing) : null
    if (confirmation) {
      setConfirming({ formData, confirmation })
      return
    }
    submit(formData)
  }

  const trigger = editing ? (
    <Button type="button" variant="outline" size="sm">
      <Pencil aria-hidden />
      {t.edit}
    </Button>
  ) : (
    <Button type="button" size="sm">
      <Plus aria-hidden />
      {t.newTemplate}
    </Button>
  )

  const submitLabel = pending
    ? editing
      ? t.saving
      : t.creating
    : editing
      ? t.save
      : t.create

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        {confirming && confirming.confirmation.kind === "edit" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.confirmEditTitle}</DialogTitle>
            </DialogHeader>
            <ConfirmationNotes
              review={
                confirming.confirmation.reviewWarning
                  ? t.confirmEditReview
                  : null
              }
              usage={
                confirming.confirmation.usedByOtherNumbers > 0
                  ? fmt(t.usedByOtherNumbers, {
                      count: confirming.confirmation.usedByOtherNumbers,
                    })
                  : null
              }
            />
            {error ? (
              <p className="text-[13px] text-destructive">{error}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={pending}
                onClick={() => setConfirming(null)}
              >
                {t.back}
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={pending}
                onClick={() => submit(confirming.formData)}
              >
                {pending ? (
                  <>
                    <LoaderCircle className="animate-spin" aria-hidden />
                    {t.saving}
                  </>
                ) : (
                  t.confirmEditSubmit
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {editing
                  ? fmt(t.editTitle, {
                      name: editing.name,
                      language: editing.language,
                    })
                  : t.createTitle}
              </DialogTitle>
              <DialogDescription>
                {editing ? t.editDescription : t.createDescription}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              <input
                type="hidden"
                name="phoneNumberId"
                value={props.phoneNumberId}
              />
              {editing ? (
                <input type="hidden" name="templateId" value={editing.id} />
              ) : (
                <div className="grid gap-3 sm:grid-cols-[1fr_140px_150px]">
                  <Field
                    id={`${idPrefix}-name`}
                    label={t.fieldName}
                    hint={t.fieldNameHint}
                  >
                    <Input
                      id={`${idPrefix}-name`}
                      name="name"
                      required
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="aviso_cita"
                      className="w-full font-mono"
                    />
                  </Field>
                  <Field
                    id={`${idPrefix}-language`}
                    label={t.fieldLanguage}
                    hint={t.fieldLanguageHint}
                  >
                    <Input
                      id={`${idPrefix}-language`}
                      name="language"
                      required
                      autoComplete="off"
                      spellCheck={false}
                      defaultValue="es_MX"
                      className="w-full font-mono"
                    />
                  </Field>
                  <Field id={`${idPrefix}-category`} label={t.fieldCategory}>
                    <select
                      id={`${idPrefix}-category`}
                      name="category"
                      defaultValue="utility"
                      className={cn(CONTROL_CLASS, "h-10 appearance-none")}
                    >
                      {TEMPLATE_DRAFT_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {t.category[category]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}

              <Field
                id={`${idPrefix}-body`}
                label={t.fieldBody}
                hint={t.fieldBodyHint}
              >
                <textarea
                  id={`${idPrefix}-body`}
                  name="body"
                  required
                  rows={5}
                  maxLength={TEMPLATE_BODY_MAX_CHARS}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  className={cn(CONTROL_CLASS, "min-h-28 resize-y py-2")}
                />
              </Field>

              {variables.length > 0 ? (
                <fieldset className="grid gap-2">
                  <legend className="text-[12.5px] text-muted-foreground">
                    {t.fieldExamplesHint}
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {variables.map((variable) => (
                      <Field
                        key={variable}
                        id={`${idPrefix}-example-${variable}`}
                        label={fmt(t.fieldExample, {
                          variable: `{{${variable}}}`,
                        })}
                      >
                        <Input
                          id={`${idPrefix}-example-${variable}`}
                          name={exampleFieldName(variable)}
                          required
                          autoComplete="off"
                          value={examples[variable] ?? ""}
                          onChange={(event) =>
                            setExamples((current) => ({
                              ...current,
                              [variable]: event.target.value,
                            }))
                          }
                          className="w-full"
                        />
                      </Field>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <Field
                id={`${idPrefix}-footer`}
                label={t.fieldFooter}
                hint={editing ? t.fieldFooterEditHint : undefined}
              >
                <Input
                  id={`${idPrefix}-footer`}
                  name="footer"
                  autoComplete="off"
                  maxLength={TEMPLATE_FOOTER_MAX_CHARS}
                  className="w-full"
                />
              </Field>

              {preview ? (
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">{t.preview}</span>
                  <p className="rounded-[10px] border border-border bg-surface-sunken px-3.5 py-3 text-[13.5px]/[1.55] whitespace-pre-wrap">
                    {preview}
                  </p>
                </div>
              ) : null}

              {error ? (
                <p className="text-[13px] text-destructive">{error}</p>
              ) : null}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="ghost" size="lg">
                    {dict.common.cancel}
                  </Button>
                </DialogClose>
                <Button type="submit" size="lg" disabled={pending}>
                  {pending ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : null}
                  {submitLabel}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Los avisos de una confirmación, uno por renglón. Lo comparte el borrado. */
export function ConfirmationNotes({
  review,
  usage,
}: {
  review?: string | null
  usage?: string | null
}) {
  const notes = [review, usage].filter((note): note is string => Boolean(note))
  if (notes.length === 0) return null
  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden />
      <AlertContent className="grid gap-1.5">
        {notes.map((note) => (
          <AlertDescription key={note} className="mt-0">
            {note}
          </AlertDescription>
        ))}
      </AlertContent>
    </Alert>
  )
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p className="text-[12px]/[1.45] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
