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

// Selector de número de `/templates`, el mismo Combobox de shadcn que el
// filtro de cuenta del Inbox pero sin la opción «todas»: el catálogo es de una
// WABA a la vez. El estado vive en `?number=`, así recarga y compartir siguen
// funcionando. Solo se dibuja con más de un número.

export type TemplateNumberOption = {
  id: string
  label: string
}

export function TemplateNumberCombobox({
  numbers,
  selectedId,
}: {
  numbers: TemplateNumberOption[]
  selectedId: string
}) {
  const t = useAppDict().templates
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const selected = numbers.find((number) => number.id === selectedId)

  function select(id: string) {
    setOpen(false)
    router.push(`/templates?number=${encodeURIComponent(id)}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        role="combobox"
        aria-expanded={open}
        aria-label={t.numberPickerLabel}
        className="inline-flex h-8 max-w-[240px] items-center gap-1.5 rounded-[8px] border border-border bg-card px-2.5 text-[13px] text-text-secondary transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-0">
        <Command>
          <CommandInput placeholder={t.numberPickerSearch} />
          <CommandList>
            <CommandEmpty>{t.numberPickerEmpty}</CommandEmpty>
            <CommandGroup>
              {numbers.map((number) => (
                <CommandItem
                  key={number.id}
                  // El id desempata dos números con el mismo label.
                  value={`${number.label} ${number.id}`}
                  onSelect={() => select(number.id)}
                  className="text-[13px]"
                >
                  <Check
                    className={cn(
                      "size-3.5",
                      number.id !== selectedId && "opacity-0"
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{number.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
