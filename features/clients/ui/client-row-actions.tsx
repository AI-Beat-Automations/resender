"use client"

import { useState, useTransition } from "react"
import { LoaderCircle } from "lucide-react"

import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import {
  cancelInvitationAction,
  deleteClientAction,
  resendInvitationAction,
  updateClientMaxAction,
  type ClientActionState,
} from "@/features/clients/actions"
import type { ClientPlan } from "@/lib/clients/client-plan"
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

// Acciones de una fila de `/clientes` (issue #154). Las dos que confirman en
// diálogo —editar tope y eliminar— siguen el molde de `revoke-api-key-dialog`;
// reenviar y cancelar son un botón con transición porque no destruyen nada
// que no se pueda rehacer (reenviar) o que no se pueda repetir (cancelar).

export type ClientRowView = {
  id: string
  name: string
  status: "pending" | "active"
  maxConnections: number
  invitation: "live" | "cancelled" | "expired" | null
  connections: { id: string; label: string }[]
}

type Action = (
  state: ClientActionState,
  formData: FormData
) => Promise<ClientActionState>

function useClientAction(action: Action, onDone?: () => void) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function run(formData: FormData) {
    startTransition(async () => {
      const result = await action({}, formData)
      if (result.error) {
        setError(result.error)
        setMessage(null)
        return
      }
      setError(null)
      setMessage(result.message ?? null)
      onDone?.()
    })
  }

  return { run, pending, error, message }
}

export function ClientRowActions({
  client,
  plan,
}: {
  client: ClientRowView
  /** Sin `canManage` (bajó de plan) solo quedan cancelar y eliminar. */
  plan: ClientPlan
}) {
  const dict = useAppDict()
  const t = dict.clients
  const resend = useClientAction(resendInvitationAction)
  const cancel = useClientAction(cancelInvitationAction)
  const pending = client.status === "pending"
  const canManage = plan.canManage
  const feedback =
    resend.error ?? cancel.error ?? resend.message ?? cancel.message
  const feedbackIsError = Boolean(resend.error ?? cancel.error)

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1.5">
        {pending && canManage ? (
          <form action={resend.run}>
            <input type="hidden" name="clientAccountId" value={client.id} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={resend.pending}
            >
              {resend.pending ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {t.resending}
                </>
              ) : (
                t.resend
              )}
            </Button>
          </form>
        ) : null}
        {pending && client.invitation === "live" ? (
          <form action={cancel.run}>
            <input type="hidden" name="clientAccountId" value={client.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={cancel.pending}
            >
              {cancel.pending ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {t.cancelling}
                </>
              ) : (
                t.cancelInvitation
              )}
            </Button>
          </form>
        ) : null}
        {canManage && plan.maxPages !== null ? (
          <EditMaxDialog client={client} maxPages={plan.maxPages} />
        ) : null}
        <DeleteClientDialog client={client} />
      </div>
      {feedback ? (
        <p
          className={
            feedbackIsError
              ? "text-[12px] text-destructive"
              : "text-[12px] text-muted-foreground"
          }
        >
          {feedback}
        </p>
      ) : null}
    </div>
  )
}

function EditMaxDialog({
  client,
  maxPages,
}: {
  client: ClientRowView
  maxPages: number
}) {
  const [open, setOpen] = useState(false)
  const dict = useAppDict()
  const t = dict.clients
  const { run, pending, error } = useClientAction(updateClientMaxAction, () =>
    setOpen(false)
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {t.editMax}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {fmt(t.editMaxTitle, { name: client.name })}
          </DialogTitle>
          <DialogDescription>{t.editMaxBody}</DialogDescription>
        </DialogHeader>
        <form action={run} className="grid gap-2">
          <input type="hidden" name="clientAccountId" value={client.id} />
          <Label htmlFor={`max-${client.id}`}>{t.maxLabel}</Label>
          <Input
            id={`max-${client.id}`}
            name="maxConnections"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxPages}
            step={1}
            defaultValue={client.maxConnections}
            required
            className="w-32"
          />
          <p className="text-[12.5px] text-muted-foreground">
            {fmt(t.maxHint, { maxPages })}
          </p>
          {error ? (
            <p className="text-[13px] text-destructive">{error}</p>
          ) : null}
          <DialogFooter className="mt-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="lg">
                {dict.common.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {t.editMaxSaving}
                </>
              ) : (
                t.editMaxSave
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// El diálogo lista las conexiones que se van a desconectar: eliminar es
// deliberado o no es.
function DeleteClientDialog({ client }: { client: ClientRowView }) {
  const [open, setOpen] = useState(false)
  const dict = useAppDict()
  const t = dict.clients
  const { run, pending, error } = useClientAction(deleteClientAction, () =>
    setOpen(false)
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          {t.delete}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fmt(t.deleteTitle, { name: client.name })}</DialogTitle>
          <DialogDescription>{t.deleteBody}</DialogDescription>
        </DialogHeader>
        {client.connections.length > 0 ? (
          <div className="rounded-lg border border-destructive-soft-border bg-destructive-soft p-3.5 text-[13px] text-destructive-soft-foreground">
            <p className="font-medium">{t.deleteConnectionsIntro}</p>
            <ul className="mt-2 list-disc pl-5">
              {client.connections.map((connection) => (
                <li key={connection.id}>{connection.label}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {t.deleteNoConnections}
          </p>
        )}
        <form action={run}>
          <input type="hidden" name="clientAccountId" value={client.id} />
          {error ? (
            <p className="text-[13px] text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="lg">
                {dict.common.cancel}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              size="lg"
              disabled={pending}
            >
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {t.deleting}
                </>
              ) : (
                t.deleteConfirm
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
