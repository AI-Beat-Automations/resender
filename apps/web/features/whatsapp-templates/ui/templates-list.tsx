import { TriangleAlert } from "lucide-react"

import { fmt, type AppDict } from "@/content/i18n/app"
import { CreateTemplateDialog } from "@/features/whatsapp-templates/ui/create-template-dialog"
import { DeleteTemplateDialog } from "@/features/whatsapp-templates/ui/delete-template-dialog"
import { EditTemplateDialog } from "@/features/whatsapp-templates/ui/edit-template-dialog"
import type {
  WhatsappTemplateRowView,
  WhatsappTemplateTone,
} from "@/lib/whatsapp-templates/template-console"
import { Badge } from "@workspace/ui/components/badge"

// El catálogo de plantillas de un número.
//
// **Una tarjeta por plantilla y no una tabla**: cada fila lleva explicaciones de
// largo variable —qué significa su estado, por qué no se puede tocar— y esas son
// justamente la razón de la pantalla. Metidas en una celda serían un `title` que
// nadie ve, y sin ellas la lista contestaría «no» sin decir por qué.
//
// Server component. Sólo los tres diálogos son cliente, porque escriben.
//
// **No hay refresco automático, y es una decisión** (ADR 0014): el `status` de
// una plantilla lo mueve Meta cuando termina de revisar y llega por webhook, que
// escribe en el espejo. Un `setInterval` o un `revalidate` periódico acá
// consultaría la base cada N segundos para pintar lo mismo el 99,9% de las
// veces, y el 0,1% restante lo resuelve el usuario volviendo a entrar. Lo que sí
// hace falta es **decirlo**, y lo dice `listBody`: una pantalla que no se
// actualiza sin avisar se lee como un olvido nuestro.

const TONE_VARIANTS: Record<
  WhatsappTemplateTone,
  "success" | "warning" | "destructiveSoft" | "outline"
> = {
  positive: "success",
  pending: "warning",
  negative: "destructiveSoft",
  // `unknown` en gris y no en rojo: no reconocer un estado no es lo mismo que
  // una plantilla rota, y pintarlo de rojo mandaría al cliente a arreglar algo
  // que a lo mejor está perfecto.
  neutral: "outline",
}

export function TemplatesList({
  templates,
  pageId,
  t,
}: {
  templates: WhatsappTemplateRowView[]
  pageId: string
  t: AppDict
}) {
  return (
    <section className="mt-6 flex flex-col gap-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-[620px]">
          <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
            {t.templates.listTitle}
          </h2>
          <p className="mt-1.5 text-[13px]/[1.6] text-muted-foreground">
            {t.templates.listBody}
          </p>
        </div>
        <div className="shrink-0">
          <CreateTemplateDialog pageId={pageId} />
        </div>
      </div>

      {templates.length === 0 ? (
        // Estado vacío explícito: sin él, una lista en blanco se lee como un
        // error de carga.
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong bg-card p-10 text-center">
          <h3 className="font-heading text-[17px] font-semibold tracking-[-0.02em]">
            {t.templates.emptyTitle}
          </h3>
          <p className="max-w-[420px] text-[13.5px]/[1.6] text-muted-foreground">
            {t.templates.emptyBody}
          </p>
        </div>
      ) : (
        templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            pageId={pageId}
            t={t}
          />
        ))
      )}
    </section>
  )
}

function TemplateCard({
  template,
  pageId,
  t,
}: {
  template: WhatsappTemplateRowView
  pageId: string
  t: AppDict
}) {
  const copy = t.templates

  return (
    <article className="rounded-2xl border border-border bg-card p-[18px] shadow-[var(--shadow-xs)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* El nombre en mono: es un identificador de Meta, no una frase, y
                se escribe con las mismas reglas que un slug. */}
            <h3 className="font-mono text-[13.5px] font-medium break-all">
              {template.name}
            </h3>
            <Badge variant={TONE_VARIANTS[template.tone]}>
              {copy.statusLabel[template.status]}
            </Badge>
            <Badge variant={template.own ? "secondary" : "outline"}>
              {template.own ? copy.ownBadge : copy.foreignBadge}
            </Badge>
          </div>

          <p className="mt-1.5 font-mono text-[11px] tracking-[0.04em] text-[var(--text-subtle)]">
            {template.language}
            {" · "}
            {template.category
              ? copy.categoryLabel[template.category]
              : copy.categoryNone}
          </p>
        </div>

        {/* Los botones sólo cuando se puede: la pantalla que oculta un botón no
            autoriza nada —la regla la aplica `template-admin.ts` en el
            servidor—, pero descubrir un 403 después de escribir un cuerpo entero
            es una emboscada y no una regla. */}
        {template.editable ? (
          <div className="flex shrink-0 gap-2">
            <EditTemplateDialog template={template} pageId={pageId} />
            <DeleteTemplateDialog template={template} pageId={pageId} />
          </div>
        ) : null}
      </div>

      {/* Qué hacer con este estado. Se calla en las aprobadas, que es el caso
          normal y el que no necesita explicación; en el resto es lo que separa
          «pausada por calidad» de «rechazada», que llevan a acciones opuestas.

          El rechazo se saca del párrafo gris y se pone en un aviso propio
          (`rejected`, decidido en `template-console.ts`). Es la única de las
          filas no aprobadas que le pide algo al usuario **ahora** —editarla y
          reenviarla, o apelar—: las demás son esperas o pausas de las que se
          sale solo. Con el mismo tratamiento que un `PENDING`, ese «te toca a
          ti» quedaba escrito en el mismo gris que un «no hagas nada», que es
          justo el motivo por el que alguien viene a esta pantalla a ver por qué
          se rechazó su plantilla. */}
      {template.status !== "APPROVED" &&
        (template.rejected ? (
          <div className="mt-2.5 flex items-start gap-2.5 rounded-lg border border-destructive-soft-border bg-destructive-soft px-3 py-2.5 text-destructive-soft-foreground">
            <TriangleAlert
              className="mt-0.5 size-[15px] shrink-0"
              aria-hidden
            />
            <p className="flex-1 text-[13px]/[1.6]">
              <StatusHelp template={template} t={t} />
            </p>
          </div>
        ) : (
          <p className="mt-2.5 text-[13px]/[1.6] text-muted-foreground">
            <StatusHelp template={template} t={t} />
          </p>
        ))}

      {template.lock ? (
        <p className="mt-2 text-[13px]/[1.6] text-[var(--text-subtle)]">
          {copy.lock[template.lock]}
        </p>
      ) : null}
    </article>
  )
}

// El texto del estado, que es el mismo lo pinte el aviso de rechazo o el
// párrafo gris: sólo cambia el envoltorio. Escrito una vez porque duplicarlo
// sería duplicar también la regla del `rawStatus` —que sólo acompaña cuando el
// estado es `unknown`— en dos ramas que nadie recordaría mantener a la par.
function StatusHelp({
  template,
  t,
}: {
  template: WhatsappTemplateRowView
  t: AppDict
}) {
  return (
    <>
      {t.templates.statusHelp[template.status]}
      {template.rawStatus ? (
        <>
          {" "}
          <span className="font-mono text-[12px]">
            {fmt(t.templates.statusRaw, { rawStatus: template.rawStatus })}
          </span>
        </>
      ) : null}
    </>
  )
}
