"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown } from "lucide-react"

import { useAppDict } from "@/content/i18n/app/provider"
import { inboxHref, type InboxTab } from "@/lib/inbox/inbox-tabs"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

// Filtro por cuenta conectada como Combobox de shadcn (Popover + Command),
// mock `1i`, ADR 0018. Es la única isla cliente de la pantalla: el estado
// sigue en `?page=` —al elegir se navega con `inboxHref`, igual que hacían las
// píldoras—, así que recarga, compartir y botón atrás siguen funcionando.
//
// Dice «cuentas» y no «páginas» desde la ADR 0008: `connected_pages` dejó de
// ser páginas de Facebook y hoy mezcla Messenger, Instagram y WhatsApp.

export type InboxFilterAccount = {
  id: string
  label: string
}

const ALL = "__all__"

export function InboxAccountCombobox({
  tab,
  accounts,
  selectedAccountId,
}: {
  tab: InboxTab
  accounts: InboxFilterAccount[]
  selectedAccountId: string | null
}) {
  const t = useAppDict().inbox
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const selected = accounts.find((account) => account.id === selectedAccountId)
  const options = [{ id: ALL, label: t.filterAll }, ...accounts]

  function select(id: string) {
    setOpen(false)
    router.push(inboxHref({ tab, pageId: id === ALL ? null : id }))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        role="combobox"
        aria-expanded={open}
        aria-label={t.accountPickerLabel}
        className="inline-flex h-[26px] max-w-[180px] items-center gap-1 rounded-[7px] border border-border bg-card px-2 text-[12px] text-text-secondary transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <span className="truncate">{selected?.label ?? t.filterAll}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[220px] p-0">
        <Command>
          <CommandInput placeholder={t.accountPickerSearch} />
          <CommandList>
            <CommandEmpty>{t.accountPickerEmpty}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const active =
                  option.id === ALL
                    ? selectedAccountId === null
                    : option.id === selectedAccountId
                return (
                  <CommandItem
                    key={option.id}
                    value={option.label}
                    onSelect={() => select(option.id)}
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
