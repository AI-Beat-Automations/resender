"use client"

import { useState, useTransition } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"

import { fmt } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
import { revokeApiKeyAction } from "@/features/api-keys/actions"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"

// Revocar confirma en `AlertDialog` (ADR 0015) y no en `window.confirm`. El
// aviso importante es que el efecto es inmediato: las llamadas que usen la key
// fallan desde ya. El disparador es `ghost` (mock 1k): en una tabla, un botón
// rojo por fila grita más de lo que ayuda.
export function RevokeApiKeyDialog({
  apiKeyId,
  label,
}: {
  apiKeyId: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dict = useAppDict()
  const t = dict.apiKeys

  // La acción se invoca a mano en vez de con `useActionState` para poder
  // cerrar el diálogo cuando confirma; la fila ya vuelve como revocada por el
  // `revalidatePath` de la acción.
  function revoke(formData: FormData) {
    startTransition(async () => {
      const result = await revokeApiKeyAction({}, formData)
      if (result.error) {
        setError(result.error)
        return
      }
      setError(null)
      setOpen(false)
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {t.revoke}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fmt(t.revokeTitle, { label })}</AlertDialogTitle>
          <AlertDialogDescription>{t.revokeBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <form action={revoke} className="grid gap-2">
          <input type="hidden" name="apiKeyId" value={apiKeyId} />
          {error ? (
            <Alert variant="destructive" role="alert">
              <TriangleAlert aria-hidden />
              <AlertTitle className="font-normal">{error}</AlertTitle>
            </Alert>
          ) : null}
          {/* Botón normal y no `AlertDialogAction`: ese cierra el diálogo al
              click y desmontaría el form antes de que la acción devuelva. */}
          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel variant="ghost">
              {dict.common.cancel}
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {t.revoking}
                </>
              ) : (
                t.revokeConfirm
              )}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
