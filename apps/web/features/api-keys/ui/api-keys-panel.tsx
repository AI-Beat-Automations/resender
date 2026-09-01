import { KeyRound } from "lucide-react"

import type { AppDict } from "@/content/i18n/app"
import { CreateApiKeyForm } from "@/features/api-keys/ui/create-api-key-form"
import { RevokeApiKeyDialog } from "@/features/api-keys/ui/revoke-api-key-dialog"
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

export type ApiKeyView = {
  id: string
  label: string
  visiblePrefix: string
  status: "active" | "revoked"
  createdAt: string
  lastUsedAt: string | null
}

// Cabeceras de tabla en mono MAYÚSCULAS (spec C.5).
const HEAD =
  "px-3 py-2.5 font-mono text-[11px] font-normal tracking-[0.06em] text-muted-foreground"

const CELL = "px-3 py-3 font-mono text-xs text-muted-foreground"

// B7. Server component: solo la creación (que devuelve el secreto una sola vez)
// y la revocación (que confirma en diálogo) necesitan cliente. Así las fechas
// se formatean en un único huso y no hay desajuste de hidratación.
export function ApiKeysPanel({
  apiKeys,
  t,
}: {
  apiKeys: ApiKeyView[]
  t: AppDict
}) {
  return (
    <div className="flex flex-col gap-4">
      <CreateApiKeyForm />

      <SettingsCard className="overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4.5">
          <SettingsCardTitle>{t.apiKeys.listTitle}</SettingsCardTitle>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {t.apiKeys.listBody}
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
              {t.apiKeys.empty}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-sunken hover:bg-surface-sunken">
                <TableHead className={`${HEAD} pl-5`}>
                  {t.apiKeys.headLabel}
                </TableHead>
                <TableHead className={HEAD}>{t.apiKeys.headPrefix}</TableHead>
                <TableHead className={HEAD}>{t.apiKeys.headStatus}</TableHead>
                <TableHead className={HEAD}>{t.apiKeys.headCreated}</TableHead>
                <TableHead className={HEAD}>{t.apiKeys.headLastUsed}</TableHead>
                <TableHead className={`${HEAD} pr-5 text-right`}>
                  <span className="sr-only">{t.apiKeys.headActions}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((apiKey) => (
                <ApiKeyRow key={apiKey.id} apiKey={apiKey} t={t} />
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsCard>
    </div>
  )
}

function ApiKeyRow({ apiKey, t }: { apiKey: ApiKeyView; t: AppDict }) {
  const revoked = apiKey.status === "revoked"

  return (
    <TableRow className={revoked ? "opacity-60" : undefined}>
      <TableCell className="max-w-50 truncate px-3 py-3 pl-5 text-[13.5px] font-medium text-foreground">
        {apiKey.label}
      </TableCell>
      <TableCell className={CELL}>{apiKey.visiblePrefix}…</TableCell>
      <TableCell className="px-3 py-3">
        {revoked ? (
          <Badge variant="ghost">{t.apiKeys.statusRevoked}</Badge>
        ) : (
          <Badge variant="success">{t.apiKeys.statusActive}</Badge>
        )}
      </TableCell>
      <TableCell className={CELL}>
        {formatDay(apiKey.createdAt, t.intl)}
      </TableCell>
      <TableCell className={CELL}>
        {apiKey.lastUsedAt ? (
          formatDayTime(apiKey.lastUsedAt, t.intl)
        ) : (
          <span className="text-[var(--text-subtle)]">{t.apiKeys.never}</span>
        )}
      </TableCell>
      <TableCell className="px-3 py-3 pr-5 text-right">
        {revoked ? (
          // Una key revocada sigue en la lista, sin acción y **sin fecha de
          // revocación**: el plugin `apiKey` no guarda cuándo se revocó y
          // mostrar `updated_at` sería mostrar la fecha de creación disfrazada
          // (CONTEXT.md → [Gestion de API keys en Settings]).
          <span className="font-mono text-[11.5px] text-[var(--text-subtle)]">
            {t.apiKeys.statusRevoked}
          </span>
        ) : (
          <RevokeApiKeyDialog apiKeyId={apiKey.id} label={apiKey.label} />
        )}
      </TableCell>
    </TableRow>
  )
}

function formatDay(iso: string, intl: string): string {
  return new Date(iso).toLocaleDateString(intl, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function formatDayTime(iso: string, intl: string): string {
  return new Date(iso).toLocaleString(intl, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
