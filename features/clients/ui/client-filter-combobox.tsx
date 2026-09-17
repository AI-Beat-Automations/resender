"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown } from "lucide-react"

import { useAppDict } from "@/content/i18n/app/provider"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// Filtro por cliente del padre (issue #154, ticket 4), gemelo del combobox de
// cuenta de Inbox: Popover + Command de shadcn, y el estado en `?cliente=`.
// Lo comparten Conexiones e Inbox, así que no sabe construir enlaces: cada
// pantalla le da las opciones **con su href ya resuelto** —el constructor de
// enlaces vive en el servidor (`inboxHref`, `connectionsHref`)— y acá solo se
// navega. Recarga, compartir y botón atrás siguen funcionando.

export type ClientFilterOption = {
  /** `null` = «todos»; si no, el valor de `?cliente=`. */
  id: string | null
  label: string
  href: string
}

export function ClientFilterCombobox({
  options,
  selectedId,
}: {
  options: ClientFilterOption[]
  selectedId: string | null
}) {
  const t = useAppDict().clients
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const selected = options.find((option) => option.id === selectedId)

  function select(option: ClientFilterOption) {
    setOpen(false)
    router.push(option.href)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        role="combobox"
        aria-expanded={open}
        aria-label={t.filterLabel}
        className="inline-flex h-[26px] max-w-[180px] items-center gap-1 rounded-[7px] border border-border bg-card px-2 text-[12px] text-text-secondary transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <span className="truncate">{selected?.label ?? t.filterAll}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[220px] p-0">
        <Command>
          <CommandInput placeholder={t.filterSearch} />
          <CommandList>
            <CommandEmpty>{t.filterEmpty}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const active = option.id === selectedId
                return (
                  <CommandItem
                    key={option.id ?? "__all__"}
                    value={option.label}
                    onSelect={() => select(option)}
                    className="text-[13px]"
                  >
                    <Check
                      className={cn("size-3.5", !active && "opacity-0")}
                      aria-hidden
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
