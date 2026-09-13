"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import {
  acceptInvitationAction,
  type AcceptInviteState,
} from "@/features/client-invite/actions"
import { Button } from "@/components/ui/button"

// Los textos llegan por props: `/invite` vive fuera de `(product)` y no tiene
// el proveedor del diccionario, igual que el reenvío de verificación en
// `/pending`.
export function AcceptInviteForm({
  token,
  label,
  pendingLabel,
}: {
  token: string
  label: string
  pendingLabel: string
}) {
  const [state, action, pending] = useActionState<AcceptInviteState, FormData>(
    acceptInvitationAction,
    {}
  )

  return (
    <form action={action} className="mt-5 flex flex-col gap-2.5">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden />}
        {pending ? pendingLabel : label}
      </Button>
      {state.error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
