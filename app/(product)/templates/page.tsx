import Link from "next/link"
import { FileText, Phone } from "lucide-react"

import { resolveActorCached } from "@/features/clients/queries"
import { listTenantPagesCached } from "@/features/connections/queries"
import { ConsolePage } from "@/features/shell/ui/console-page"
import { TemplateNumberCombobox } from "@/features/templates/ui/template-number-combobox"
import { TemplateEditorDialog } from "@/features/templates/ui/template-editor-dialog"
import { TemplatesEmpty } from "@/features/templates/ui/templates-empty"
import { TemplatesTable } from "@/features/templates/ui/templates-table"
import { getSession } from "@/lib/auth/session"
import { getAppDict } from "@/lib/i18n/app-dict"
import {
  countTemplateUsageByOtherNumbers,
  listWhatsappTemplatesForWaba,
} from "@/lib/whatsapp-templates/template-store"
import {
  resolveTemplateNumber,
  templateNumbersForActor,
  toTemplateRows,
} from "@/lib/whatsapp-templates/template-visibility"
import { Button } from "@/components/ui/button"

// `/templates` (issue #195): el catálogo de [Plantilla]s de WhatsApp de los
// números del actor. El padre ve las de todas las WABAs del tenant; el
// cliente, solo las de sus números. Lee la copia local al cargar: el estado lo
// mantiene el webhook y no hay polling. Las propias se crean, editan y borran
// desde acá (issue #196).
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ number?: string | string[] }>
}) {
  const [session, params, t] = await Promise.all([
    getSession(),
    searchParams,
    getAppDict(),
  ])
  // Sin actor no hay nada que listar; el layout ya rebotó.
  const resolution = session?.user?.id
    ? await resolveActorCached(session.user.id)
    : null
  if (resolution?.kind !== "actor") return null
  const { actor } = resolution

  // Misma llamada que Conexiones e Inbox para que el caché de petición la
  // deduplique; ya viene con el alcance del actor.
  const pages = await listTenantPagesCached(
    actor.tenantId,
    actor.clientAccountId
  )
  const numbers = templateNumbersForActor(pages, actor)
  const numberParam = Array.isArray(params.number)
    ? params.number[0]
    : params.number
  const selected = resolveTemplateNumber(numbers, numberParam)
  const templates = selected
    ? await listWhatsappTemplatesForWaba(selected.wabaId)
    : []
  const rows = toTemplateRows(templates, actor)
  // El aviso «la usaron N números más» se muestra antes de confirmar, así que
  // se cuenta al cargar; solo para las propias, que son las que tienen botones.
  const usage = selected
    ? Object.fromEntries(
        await Promise.all(
          rows
            .filter((row) => row.owned)
            .map(async (row) => [
              row.id,
              await countTemplateUsageByOtherNumbers({
                wabaId: selected.wabaId,
                name: row.name,
                language: row.language,
                actor,
              }),
            ])
        )
      )
    : {}

  return (
    <ConsolePage className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-[-0.02em]">
            {t.templates.title}
          </h1>
          <p className="mt-1.5 max-w-[600px] text-sm/[1.55] text-muted-foreground">
            {t.templates.subtitle}
          </p>
        </div>
        {selected ? (
          <div className="flex flex-wrap items-center gap-2">
            {numbers.length > 1 ? (
              <TemplateNumberCombobox
                numbers={numbers.map(({ id, label }) => ({ id, label }))}
                selectedId={selected.id}
              />
            ) : null}
            <TemplateEditorDialog
              mode="create"
              phoneNumberId={selected.phoneNumberId}
            />
          </div>
        ) : null}
      </header>

      {!selected ? (
        <TemplatesEmpty
          icon={Phone}
          title={t.templates.emptyNumbersTitle}
          body={t.templates.emptyNumbersBody}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/connections">{t.templates.emptyNumbersCta}</Link>
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <TemplatesEmpty
          icon={FileText}
          title={t.templates.emptyTemplatesTitle}
          body={t.templates.emptyTemplatesBody}
        />
      ) : (
        <TemplatesTable
          rows={rows}
          phoneNumberId={selected.phoneNumberId}
          usage={usage}
          t={t}
        />
      )}
    </ConsolePage>
  )
}
