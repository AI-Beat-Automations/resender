import { KeyRound } from "lucide-react"

import { CreateApiKeyForm } from "@/features/api-keys/ui/create-api-key-form"
import { RevokeApiKeyDialog } from "@/features/api-keys/ui/revoke-api-key-dialog"
import type { ApiKeyView } from "@/lib/settings/view-model"
import {
  SettingsCard,
  SettingsCardTitle,
} from "@/features/settings/ui/settings-card"
import { Badge } from "@workspace/ui/components/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

// Cabeceras de tabla en mono MAYÚSCULAS (spec C.5).
const HEAD =
  "px-3 py-2.5 font-mono text-[11px] font-normal tracking-[0.06em] text-muted-foreground"

const CELL = "px-3 py-3 font-mono text-xs text-muted-foreground"

// B7. Server component: solo la creación (que devuelve el secreto una sola vez)
// y la revocación (que confirma en diálogo) necesitan cliente. Así las fechas
// se formatean en un único huso y no hay desajuste de hidratación.
export function ApiKeysPanel({ apiKeys }: { apiKeys: ApiKeyView[] }) {
  return (
    <div className="flex flex-col gap-4">
      <CreateApiKeyForm />

      <SettingsCard className="overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4.5">
          <SettingsCardTitle>API keys</SettingsCardTitle>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Revocar es inmediato: las llamadas con esa key empiezan a fallar.
          </p>
        </div>

        {apiKeys.length === 0 ? (
          // Estado vacío explícito: sin él, una tabla en blanco se lee como un
          // error de carga.
          <div className="flex items-center gap-3 px-5 py-6">
            <KeyRound
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <p className="text-[13.5px] text-muted-foreground">
              Todavía no creaste ninguna API key.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-sunken hover:bg-surface-sunken">
                <TableHead className={`${HEAD} pl-5`}>ETIQUETA</TableHead>
                <TableHead className={HEAD}>PREFIJO</TableHead>
                <TableHead className={HEAD}>ESTADO</TableHead>
                <TableHead className={HEAD}>CREADA</TableHead>
                <TableHead className={HEAD}>ÚLTIMO USO</TableHead>
                <TableHead className={`${HEAD} pr-5 text-right`}>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((apiKey) => (
                <ApiKeyRow key={apiKey.id} apiKey={apiKey} />
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsCard>
    </div>
  )
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKeyView }) {
  const revoked = apiKey.status === "revoked"

  return (
    <TableRow className={revoked ? "opacity-60" : undefined}>
      <TableCell className="max-w-50 truncate px-3 py-3 pl-5 text-[13.5px] font-medium text-foreground">
        {apiKey.label}
      </TableCell>
      <TableCell className={CELL}>{apiKey.visiblePrefix}…</TableCell>
      <TableCell className="px-3 py-3">
        {revoked ? (
          <Badge variant="ghost">revocada</Badge>
        ) : (
          <Badge variant="success">activa</Badge>
        )}
      </TableCell>
      <TableCell className={CELL}>{formatDay(apiKey.createdAt)}</TableCell>
      <TableCell className={CELL}>
        {apiKey.lastUsedAt ? (
          formatDayTime(apiKey.lastUsedAt)
        ) : (
          <span className="text-[var(--text-subtle)]">nunca</span>
        )}
      </TableCell>
      <TableCell className="px-3 py-3 pr-5 text-right">
        {revoked ? (
          // Una key revocada sigue en la lista, sin acción (CONTEXT.md).
          <span className="font-mono text-[11.5px] text-[var(--text-subtle)]">
            {apiKey.revokedAt
              ? `revocada el ${formatShortDay(apiKey.revokedAt)}`
              : "revocada"}
          </span>
        ) : (
          <RevokeApiKeyDialog apiKeyId={apiKey.id} label={apiKey.label} />
        )}
      </TableCell>
    </TableRow>
  )
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function formatShortDay(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  })
}

function formatDayTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
