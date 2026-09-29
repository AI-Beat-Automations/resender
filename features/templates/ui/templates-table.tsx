import { Lock } from "lucide-react"

import type { AppDict } from "@/content/i18n/app"
import {
  templateStatusTone,
  type TemplateRowView,
} from "@/lib/whatsapp-templates/template-visibility"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { DeleteTemplateDialog } from "./delete-template-dialog"
import { TemplateEditorDialog } from "./template-editor-dialog"

// Cabeceras de tabla en mono MAYÚSCULAS (spec C.5), como API keys.
const HEAD =
  "px-3 py-2.5 font-mono text-[11px] font-normal tracking-[0.06em] text-muted-foreground"

const CELL = "px-3 py-3 font-mono text-xs text-muted-foreground"

// El catálogo de una WABA (issue #195). Server component: el estado lo
// mantiene al día el webhook y la página lo lee al cargar, sin polling. El
// cuerpo va abreviado a dos renglones; el `title` lo da entero. Las propias
// traen editar y borrar (issue #196); las demás, ningún botón.
export function TemplatesTable({
  rows,
  phoneNumberId,
  usage,
  t,
}: {
  rows: TemplateRowView[]
  /** El número elegido, con el que se edita y borra. */
  phoneNumberId: string
  /** Por id de plantilla propia: cuántos números más la enviaron. */
  usage: Record<string, number>
  t: AppDict
}) {
  const copy = t.templates
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-xs)]">
      <Table>
        <TableHeader>
          <TableRow className="bg-surface-sunken hover:bg-surface-sunken">
            <TableHead className={`${HEAD} pl-5`}>{copy.columnName}</TableHead>
            <TableHead className={HEAD}>{copy.columnLanguage}</TableHead>
            <TableHead className={HEAD}>{copy.columnCategory}</TableHead>
            <TableHead className={HEAD}>{copy.columnStatus}</TableHead>
            <TableHead className={HEAD}>{copy.columnBody}</TableHead>
            <TableHead className={HEAD}>{copy.columnOwnership}</TableHead>
            <TableHead className={`${HEAD} pr-5 text-right`}>
              {copy.columnActions}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-56 truncate px-3 py-3 pl-5 font-mono text-[13px] font-medium text-foreground">
                {row.name}
              </TableCell>
              <TableCell className={CELL}>{row.language}</TableCell>
              <TableCell className="px-3 py-3 text-[13px] text-muted-foreground">
                {row.category ? copy.category[row.category] : copy.noCategory}
              </TableCell>
              <TableCell className="px-3 py-3">
                <Badge
                  variant={templateStatusTone(row.status)}
                  title={row.status}
                >
                  {copy.status[row.status]}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[360px] px-3 py-3 text-[13px] whitespace-normal text-muted-foreground">
                {row.body ? (
                  <span className="line-clamp-2" title={row.body}>
                    {row.body}
                  </span>
                ) : (
                  <span className="text-[var(--text-subtle)]">
                    {copy.noBody}
                  </span>
                )}
              </TableCell>
              <TableCell className="px-3 py-3">
                {row.owned ? (
                  <Badge variant="info">{copy.owned}</Badge>
                ) : (
                  <Badge variant="ghost" title={copy.readOnlyHint}>
                    <Lock aria-hidden />
                    {copy.readOnly}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="px-3 py-3 pr-5">
                {row.owned ? (
                  <div className="flex justify-end gap-1.5">
                    <TemplateEditorDialog
                      mode="edit"
                      phoneNumberId={phoneNumberId}
                      template={{
                        ...row,
                        usedByOtherNumbers: usage[row.id] ?? 0,
                      }}
                    />
                    <DeleteTemplateDialog
                      phoneNumberId={phoneNumberId}
                      template={{
                        ...row,
                        usedByOtherNumbers: usage[row.id] ?? 0,
                      }}
                    />
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
