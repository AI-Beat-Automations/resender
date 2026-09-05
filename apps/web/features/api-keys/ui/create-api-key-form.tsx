"use client"

import { useActionState } from "react"
import { Check, LoaderCircle, TriangleAlert } from "lucide-react"

import {
  createApiKeyAction,
  type CreateApiKeyState,
} from "@/features/api-keys/actions"
import { useAppDict } from "@/content/i18n/app/provider"
import { CopyButton } from "@/features/settings/ui/copy-button"
import { SettingsCardHeader } from "@/features/settings/ui/settings-card"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"

export function CreateApiKeyForm() {
  const [state, action, pending] = useActionState<CreateApiKeyState, FormData>(
    createApiKeyAction,
    {}
  )
  const t = useAppDict().apiKeys

  return (
    <Card>
      <SettingsCardHeader title={t.createTitle} description={t.createBody} />
      <CardContent className="flex flex-col gap-4">
        <form action={action} className="flex gap-2">
          <Input
            name="label"
            required
            maxLength={80}
            placeholder={t.labelPlaceholder}
            aria-label={t.labelAria}
            className="flex-1"
          />
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className="animate-spin" aria-hidden />
                {t.creating}
              </>
            ) : (
              t.create
            )}
          </Button>
        </form>
        {state.error ? (
          <Alert variant="destructive" role="alert">
            <TriangleAlert aria-hidden />
            <AlertTitle className="font-normal">{state.error}</AlertTitle>
          </Alert>
        ) : null}
        {state.apiKey ? (
          // Es la única vez que el secreto existe en pantalla: `status` y no
          // `alert`, confirma sin interrumpir al lector de pantalla.
          <Alert variant="success" role="status" aria-live="polite">
            <Check aria-hidden />
            <AlertTitle>{t.revealTitle}</AlertTitle>
            <div className="col-start-2 mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-card px-2.5 py-2 font-mono text-[12.5px] text-foreground">
                {state.apiKey}
              </code>
              <CopyButton
                value={state.apiKey}
                label={t.copyKey}
                withText
                variant="outline"
                size="sm"
              />
            </div>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
