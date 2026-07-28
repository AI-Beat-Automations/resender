"use client"

import { useState, useTransition } from "react"
import { LoaderCircle } from "lucide-react"

import { revokeApiKeyAction } from "@/features/api-keys/actions"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"

// Revocar pasa de `window.confirm` a diálogo (ADR 0005). El aviso importante
// es que el efecto es inmediato: las llamadas que usen la key fallan desde ya.
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          Revocar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revocar «{label}»</DialogTitle>
          <DialogDescription>
            El efecto es inmediato: las llamadas que usen esta key empiezan a
            fallar. La key sigue visible en la lista como revocada, y no se
            puede volver a activar.
          </DialogDescription>
        </DialogHeader>
        <form action={revoke}>
          <input type="hidden" name="apiKeyId" value={apiKeyId} />
          {error ? (
            <p className="text-[13px] text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="lg">
                Cancelar
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
                  Revocando…
                </>
              ) : (
                "Sí, revocar"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
