import { Users } from "lucide-react"

import { fmt, type AppDict } from "@/content/i18n/app"
import {
  ClientRowActions,
  type ClientRowView,
} from "@/features/clients/ui/client-row-actions"
import {
  SettingsCard,
  SettingsCardTitle,
} from "@/features/settings/ui/settings-card"
import type { ClientPlan } from "@/lib/clients/client-plan"
import { isOverMax } from "@/lib/clients/client-rules"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type ClientView = ClientRowView & { email: string | null }

// Cabeceras de tabla en mono MAYÚSCULAS (spec C.5), como las API keys.
const HEAD =
  "px-3 py-2.5 font-mono text-[11px] font-normal tracking-[0.06em] text-muted-foreground"

// Lista de `/clientes` (issue #154). Server component: las acciones de cada
// fila son lo único que necesita cliente.
export function ClientsPanel({
  clients,
  plan,
  t,
}: {
  clients: ClientView[]
  plan: ClientPlan
  t: AppDict
}) {
  return (
    <SettingsCard className="overflow-hidden p-0">
      <div className="border-b border-border px-5 py-4.5">
        <SettingsCardTitle>{t.clients.listTitle}</SettingsCardTitle>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {t.clients.listBody}
        </p>
      </div>

      {clients.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-6">
          <Users
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <p className="text-[13.5px] text-muted-foreground">
            {t.clients.empty}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-sunken hover:bg-surface-sunken">
              <TableHead className={`${HEAD} pl-5`}>
                {t.clients.headName}
              </TableHead>
              <TableHead className={HEAD}>{t.clients.headEmail}</TableHead>
              <TableHead className={HEAD}>{t.clients.headStatus}</TableHead>
              <TableHead className={HEAD}>{t.clients.headUsage}</TableHead>
              <TableHead className={`${HEAD} pr-5 text-right`}>
                <span className="sr-only">{t.clients.headActions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <ClientRow key={client.id} client={client} plan={plan} t={t} />
            ))}
          </TableBody>
        </Table>
      )}
    </SettingsCard>
  )
}

function ClientRow({
  client,
  plan,
  t,
}: {
  client: ClientView
  plan: ClientPlan
  t: AppDict
}) {
  const connected = client.connections.length
  const over = isOverMax(connected, client.maxConnections)
  const note =
    client.status === "pending" && client.invitation === "cancelled"
      ? t.clients.invitationCancelledNote
      : client.status === "pending" && client.invitation === "expired"
        ? t.clients.invitationExpiredNote
        : null

  return (
    <TableRow>
      <TableCell className="max-w-50 truncate px-3 py-3 pl-5 text-[13.5px] font-medium text-foreground">
        {client.name}
      </TableCell>
      <TableCell className="px-3 py-3 font-mono text-xs text-muted-foreground">
        {client.email ?? "—"}
      </TableCell>
      <TableCell className="px-3 py-3">
        <div className="flex flex-col items-start gap-1">
          {client.status === "active" ? (
            <Badge variant="success">{t.clients.statusActive}</Badge>
          ) : (
            <Badge variant="warning">{t.clients.statusPending}</Badge>
          )}
          {note ? (
            <span className="font-mono text-[11px] text-[var(--text-subtle)]">
              {note}
            </span>
          ) : null}
        </div>
      </TableCell>
      {/* `conectadas / tope` en rojo cuando lo conectado supera el tope: el
          tope es un máximo, no una reserva, y bajarlo no desconecta nada. */}
      <TableCell
        className={cn(
          "px-3 py-3 font-mono text-xs",
          over ? "font-semibold text-[var(--danger-text)]" : "text-foreground"
        )}
      >
        {fmt(t.clients.usage, { connected, max: client.maxConnections })}
      </TableCell>
      <TableCell className="px-3 py-3 pr-5 text-right">
        <ClientRowActions client={client} plan={plan} />
      </TableCell>
    </TableRow>
  )
}
