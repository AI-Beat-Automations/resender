"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import {
  createClientAction,
  type ClientActionState,
} from "@/features/clients/actions"
import {
  SettingsCard,
  SettingsCardTitle,
} from "@/features/settings/ui/settings-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Alta de un cliente (issue #154): nombre, correo y tope. Al guardar sale la
// invitación. Molde de `create-api-key-form`.
export function CreateClientForm({ maxPages }: { maxPages: number }) {
  const [state, action, pending] = useActionState<ClientActionState, FormData>(
    createClientAction,
    {}
  )
  const t = useAppDict().clients

  return (
    <SettingsCard>
      <SettingsCardTitle>{t.createTitle}</SettingsCardTitle>
      <p className="mt-1 text-[13.5px]/[1.55] text-muted-foreground">
        {t.createBody}
      </p>
      <form
        action={action}
        className="mt-4 grid max-w-180 gap-3 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="client-name">{t.nameLabel}</Label>
          <Input
            id="client-name"
            name="name"
            required
            placeholder={t.namePlaceholder}
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="client-email">{t.emailLabel}</Label>
          <Input
            id="client-email"
            name="email"
            type="email"
            required
            placeholder={t.emailPlaceholder}
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="client-max">{t.maxLabel}</Label>
          <Input
            id="client-max"
            name="maxConnections"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxPages}
            step={1}
            defaultValue={1}
            required
          />
        </div>
        <Button type="submit" size="lg" disabled={pending}>
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
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        {fmt(t.maxHint, { maxPages })}
      </p>
      {state.error ? (
        <p className="mt-3 text-[13px] text-destructive">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="mt-3 text-[13px] text-success-soft-foreground">
          {state.message}
        </p>
      ) : null}
    </SettingsCard>
  )
}
