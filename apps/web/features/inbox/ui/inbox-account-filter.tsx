"use client"

import { useRouter } from "next/navigation"

import { useAppDict } from "@/content/i18n/app/provider"
import { inboxHref, type InboxTab } from "@/lib/inbox/inbox-tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

// Filtro por cuenta conectada como `Select` de shadcn (ADR 0015). Es la
// excepción a «Inbox es server component entero» (ADR 0005): un `Select` de
// Radix necesita `onValueChange` en el cliente para navegar, y no hay forma de
// que un `<select>` nativo produzca una navegación sin JS. La isla es mínima —
// solo este control— y el estado sigue viviendo en la URL: elegir una cuenta
// hace `router.push` a exactamente la misma URL que producían las píldoras
// (`inboxHref`), incluida «Todas las cuentas» = sin `?page=`.
//
// Dice «cuentas» y no «páginas» desde la ADR 0008: `connected_pages` dejó de
// ser páginas de Facebook y hoy mezcla Messenger, Instagram y WhatsApp.

export type InboxFilterAccount = {
  id: string
  name: string
}

// Radix no admite `""` como valor de un item: «todas» lleva un centinela que
// nunca colisiona con un id de cuenta (son UUID).
const ALL_ACCOUNTS = "__all__"

export function InboxAccountFilter({
  tab,
  accounts,
  selectedAccountId,
}: {
  tab: InboxTab
  accounts: InboxFilterAccount[]
  selectedAccountId: string | null
}) {
  const router = useRouter()
  const t = useAppDict().inbox

  // Sin cuentas no hay nada que filtrar: un desplegable con solo «Todas las
  // cuentas» es un control que no hace nada.
  if (accounts.length === 0) return null

  return (
    <Select
      value={selectedAccountId ?? ALL_ACCOUNTS}
      onValueChange={(value) => {
        router.push(
          inboxHref({ tab, pageId: value === ALL_ACCOUNTS ? null : value })
        )
      }}
    >
      <SelectTrigger
        aria-label={t.filterAria}
        className="w-full min-w-0 bg-card"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={ALL_ACCOUNTS}>{t.filterAll}</SelectItem>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
