"use client"

import { useState, useTransition } from "react"
import { Check, LoaderCircle, Users } from "lucide-react"

import { assignConnectionAction } from "@/features/clients/actions"
import { useAppDict } from "@/content/i18n/app/provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type AssignableClient = { id: string; name: string }

// Asignar una conexión a un cliente de agencia, moverla o dejarla sin asignar
// (ADR 0020). Lo ve solo el dueño. Reasignar mueve también el historial
// visible, y el menú lo dice antes de elegir.
export function AssignConnectionMenu({
  connectionId,
  currentClientId,
  clients,
}: {
  connectionId: string
  currentClientId: string | null
  clients: AssignableClient[]
}) {
  const t = useAppDict()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function assign(clientId: string | null) {
    if (clientId === currentClientId) return
    setError(null)
    startTransition(async () => {
      const result = await assignConnectionAction(connectionId, clientId)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-1 self-start sm:items-end sm:self-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-[13px] text-muted-foreground"
            disabled={pending}
          >
            {pending ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Users className="size-3.5" aria-hidden />
            )}
            {currentClientId === null ? t.clients.assign : t.clients.moveTo}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[12px] font-normal whitespace-normal text-muted-foreground">
            {t.clients.assignHint}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {clients.map((client) => (
            <DropdownMenuItem
              key={client.id}
              onSelect={() => assign(client.id)}
            >
              <span className="flex-1 truncate">{client.name}</span>
              {client.id === currentClientId ? (
                <Check className="size-3.5" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          ))}
          {currentClientId !== null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => assign(null)}>
                {t.clients.unassign}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p className="text-[12px] text-[var(--danger-text)]">{error}</p>
      ) : null}
    </div>
  )
}
