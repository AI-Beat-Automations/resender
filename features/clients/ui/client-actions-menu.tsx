"use client"

import { startTransition, useActionState, useState } from "react"
import { LoaderCircle, MoreHorizontal, TriangleAlert } from "lucide-react"

import {
  cancelAgencyClientInviteAction,
  createAgencyClientInviteAction,
  deleteAgencyClientAction,
  renameAgencyClientAction,
  revokeAgencyClientAccessAction,
  type ClientActionState,
  type InviteActionState,
} from "@/features/clients/actions"
import { CopyButton } from "@/features/settings/ui/copy-button"
import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CLIENT_NAME_MAX_LENGTH } from "@/lib/clients/client-name"

export type ClientMenuView = {
  id: string
  name: string
  memberEmail: string | null
  hasPendingInvitation: boolean
}

type OpenDialog = "invite" | "rename" | "revoke" | "delete" | null

// Acciones sobre un cliente de agencia, en el encabezado de su grupo en
// Conexiones (ADR 0020). Un solo menú con los diálogos controlados desde acá:
// abrir un diálogo desde un item del menú sin cerrarlo primero deja el foco
// atrapado en un menú que ya no existe.
export function ClientActionsMenu({ client }: { client: ClientMenuView }) {
  const t = useAppDict()
  const [open, setOpen] = useState<OpenDialog>(null)
  const [cancelState, cancelAction] = useActionState<
    ClientActionState,
    FormData
  >(cancelAgencyClientInviteAction, {})
  const close = () => setOpen(null)

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Invitar va a la vista y no escondido en el menú: es el paso
            habitual después de crear el cliente. */}
        {client.memberEmail === null ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setOpen("invite")}
          >
            {client.hasPendingInvitation ? t.clients.newLink : t.clients.invite}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t.clients.menuAria}
              title={t.clients.menuAria}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {client.hasPendingInvitation ? (
              <DropdownMenuItem
                onSelect={() => {
                  const formData = new FormData()
                  formData.set("clientId", client.id)
                  // Fuera de un `<form>`, la acción tiene que ir en una
                  // transición para que React maneje su estado pendiente.
                  startTransition(() => cancelAction(formData))
                }}
              >
                {t.clients.cancelInvite}
              </DropdownMenuItem>
            ) : null}
            {client.memberEmail !== null ? (
              <DropdownMenuItem onSelect={() => setOpen("revoke")}>
                {t.clients.revokeAccess}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => setOpen("rename")}>
              {t.clients.rename}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setOpen("delete")}
            >
              {t.clients.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {cancelState.error ? (
        <p className="text-[12px] text-[var(--danger-text)]">
          {cancelState.error}
        </p>
      ) : null}

      {open === "invite" ? (
        <InviteDialog client={client} onClose={close} />
      ) : null}
      {open === "rename" ? (
        <RenameDialog client={client} onClose={close} />
      ) : null}
      {open === "revoke" && client.memberEmail !== null ? (
        <ConfirmDialog
          action={revokeAgencyClientAccessAction}
          clientId={client.id}
          title={fmt(t.clients.revokeTitle, { email: client.memberEmail })}
          body={t.clients.revokeBody}
          confirm={t.clients.revokeAccess}
          pendingLabel={t.clients.revoking}
          onClose={close}
        />
      ) : null}
      {open === "delete" ? (
        <ConfirmDialog
          action={deleteAgencyClientAction}
          clientId={client.id}
          title={fmt(t.clients.deleteTitle, { name: client.name })}
          body={t.clients.deleteBody}
          confirm={t.clients.delete}
          pendingLabel={t.clients.deleting}
          onClose={close}
        />
      ) : null}
    </>
  )
}

function InviteDialog({
  client,
  onClose,
}: {
  client: ClientMenuView
  onClose: () => void
}) {
  const t = useAppDict()
  const [state, action, pending] = useActionState<InviteActionState, FormData>(
    createAgencyClientInviteAction,
    {}
  )

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {fmt(t.clients.inviteTitle, { name: client.name })}
          </DialogTitle>
          <DialogDescription>{t.clients.inviteBody}</DialogDescription>
        </DialogHeader>

        {state.inviteUrl ? (
          // La única vez que el enlace existe en pantalla, como el secreto de
          // una API key: al cerrar el diálogo se va.
          <div className="rounded-lg border border-warning-soft-border bg-warning-soft p-4 text-warning-soft-foreground">
            <p className="flex items-start gap-2 text-[13.5px] font-medium">
              <TriangleAlert
                className="mt-0.5 size-[15px] shrink-0"
                aria-hidden
              />
              {t.clients.linkRevealTitle}
            </p>
            <div className="mt-3 flex gap-2.5">
              <code className="flex-1 overflow-hidden rounded-lg bg-card px-3.5 py-3 font-mono text-[12.5px] text-ellipsis whitespace-nowrap text-foreground select-all">
                {state.inviteUrl}
              </code>
              <CopyButton
                value={state.inviteUrl}
                label={t.clients.copyLink}
                withText
                variant="default"
                size="lg"
              />
            </div>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="clientId" value={client.id} />
            <div className="grid gap-2">
              <Label htmlFor={`invite-email-${client.id}`}>
                {t.clients.inviteEmailLabel}
              </Label>
              <Input
                id={`invite-email-${client.id}`}
                name="email"
                type="email"
                autoComplete="off"
              />
              <p className="text-[12.5px] text-muted-foreground">
                {t.clients.inviteEmailHint}
              </p>
            </div>
            {state.error ? (
              <p className="text-[12.5px] text-[var(--danger-text)]">
                {state.error}
              </p>
            ) : null}
            <Button type="submit" size="lg" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden />}
              {pending ? t.clients.generating : t.clients.generateLink}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({
  client,
  onClose,
}: {
  client: ClientMenuView
  onClose: () => void
}) {
  const t = useAppDict()
  const [state, action, pending] = useActionState<ClientActionState, FormData>(
    async (previous, formData) => {
      const result = await renameAgencyClientAction(previous, formData)
      if (result.doneAt) onClose()
      return result
    },
    {}
  )

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.clients.renameTitle}</DialogTitle>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="clientId" value={client.id} />
          <div className="grid gap-2">
            <Label htmlFor={`rename-${client.id}`}>{t.clients.nameLabel}</Label>
            <Input
              id={`rename-${client.id}`}
              name="name"
              required
              maxLength={CLIENT_NAME_MAX_LENGTH}
              defaultValue={client.name}
            />
          </div>
          {state.error ? (
            <p className="text-[12.5px] text-[var(--danger-text)]">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
            {pending ? t.common.saving : t.common.save}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDialog({
  action: serverAction,
  clientId,
  title,
  body,
  confirm,
  pendingLabel,
  onClose,
}: {
  action: (
    state: ClientActionState,
    formData: FormData
  ) => Promise<ClientActionState>
  clientId: string
  title: string
  body: string
  confirm: string
  pendingLabel: string
  onClose: () => void
}) {
  const t = useAppDict()
  const [state, action, pending] = useActionState<ClientActionState, FormData>(
    async (previous, formData) => {
      const result = await serverAction(previous, formData)
      if (result.doneAt) onClose()
      return result
    },
    {}
  )

  return (
    // `AlertDialog`: es destructivo y no se cierra por clic fuera (ADR 0005).
    <AlertDialog open onOpenChange={(next) => (next ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="mt-2">
            {body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form action={action}>
          <input type="hidden" name="clientId" value={clientId} />
          {state.error ? (
            <p className="mb-3 text-[12.5px] text-[var(--danger-text)]">
              {state.error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">
              {t.common.cancel}
            </AlertDialogCancel>
            {/* Submit real del form, como en la desconexión: `AlertDialogAction`
                cerraría el diálogo antes de ver el error. */}
            <Button
              type="submit"
              variant="destructive"
              size="lg"
              disabled={pending}
            >
              {pending && (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              )}
              {pending ? pendingLabel : confirm}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
