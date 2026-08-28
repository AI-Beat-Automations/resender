import Link from "next/link"
import { MessageCircle, TriangleAlert } from "lucide-react"

import { auth } from "@/auth"
import { TemplatesList } from "@/features/whatsapp-templates/ui/templates-list"
import { TemplatesNumberFilter } from "@/features/whatsapp-templates/ui/templates-number-filter"
import type { AppDict } from "@/content/i18n/app"
import { getAppDict } from "@/lib/i18n/app-dict"
import { listTenantPages } from "@/lib/pages/page-registry"
import { listWhatsappTemplatesForTenant } from "@/lib/whatsapp-templates/template-admin"
import {
  describeWhatsappTemplateFailure,
  resolveWhatsappNumberSelection,
  toWhatsappNumberOptions,
  toWhatsappTemplateRowViews,
} from "@/lib/whatsapp-templates/template-console"
import { Button } from "@workspace/ui/components/button"

// La pantalla de [Plantilla]s de WhatsApp (ADR 0014).
//
// Es superficie nueva: hasta esta entrega la consola no tenía **ninguna**
// pantalla de WhatsApp —sólo Conexiones, Inbox y Ajustes—, porque el canal sólo
// sabía responder dentro de la [Ventana de atención]. La plantilla es lo único
// que WhatsApp acepta con esa ventana cerrada, así que esta pantalla es donde el
// negocio se gana el derecho a escribir primero.
//
// **Se direcciona por número aunque la plantilla viva en la WABA.** Toda la
// superficie del producto —la API pública incluida— es orientada al número, y la
// WABA la resuelve el servidor: pedírsela al cliente sería filtrarle un
// identificador que además comparte con otros negocios. La consecuencia visible
// es que dos números de la misma WABA muestran el mismo catálogo, y eso es la
// verdad y no un error de esta pantalla.
//
// **Llama a `lib/*` directo, sin pasar por `/api/meta/whatsapp/templates`.** Es
// como funciona toda la consola desde la ADR 0012 —un solo Worker— y como se
// autentica: con `auth()` de la sesión, no con una API key. La orquestación es
// exactamente la misma que la de la API pública porque es literalmente la misma
// función (`template-admin.ts`); lo único propio de acá es la presentación.
//
// **No hay polling ni revalidación periódica, a propósito.** El `status` de una
// plantilla lo mueve Meta cuando termina de revisarla y llega por webhook, que
// escribe en el espejo. Consultar cada N segundos para pintar lo mismo casi
// siempre es gasto sin lector, y el caso raro —estar mirando la pantalla en el
// instante exacto de la aprobación— lo resuelve volver a entrar. Está escrito
// acá y dicho en pantalla (`t.templates.listBody`) porque «esto no se refresca»
// parece un olvido y es una decisión.
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ number?: string | string[] }>
}) {
  const [session, params, t] = await Promise.all([
    auth(),
    searchParams,
    getAppDict(),
  ])
  const tenantId = session?.user?.id
  // El layout ya redirige a `/login` sin sesión; esto es la guarda de tipos.
  if (!tenantId) return null

  const numbers = toWhatsappNumberOptions(await listTenantPages(tenantId))
  const selected = resolveWhatsappNumberSelection(numbers, params.number)

  return (
    <div>
      <header>
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-subtle)]">
          {`// ${t.templates.eyebrow}`}
        </p>
        <h1 className="mt-1.5 font-heading text-[26px] font-bold tracking-[-0.02em]">
          {t.templates.title}
        </h1>
        <p className="mt-2 max-w-[640px] text-[14.5px]/[1.6] text-muted-foreground">
          {t.templates.subtitle}
        </p>
        {selected ? (
          <TemplatesNumberFilter
            numbers={numbers}
            selectedPageId={selected.pageId}
            t={t}
          />
        ) : null}
      </header>

      {selected ? (
        <TemplatesForNumber
          tenantId={tenantId}
          pageId={selected.pageId}
          t={t}
        />
      ) : (
        <NoNumbersState t={t} />
      )}
    </div>
  )
}

// El catálogo de un número, o el motivo por el que no se pudo leer.
//
// El fallo se pinta en vez de lanzar: los motivos que puede devolver el listado
// —el número dejó de estar conectado, la conexión no tiene WABA— son cosas que
// el usuario puede arreglar desde Conexiones, y una pantalla de error genérica
// se las escondería.
async function TemplatesForNumber({
  tenantId,
  pageId,
  t,
}: {
  tenantId: string
  pageId: string
  t: AppDict
}) {
  const result = await listWhatsappTemplatesForTenant({ tenantId, pageId })

  if (!result.ok) {
    const failure = describeWhatsappTemplateFailure(result)

    return (
      <div className="mt-6 flex items-start gap-3 rounded-lg border border-destructive-soft-border bg-destructive-soft px-3.5 py-3 text-destructive-soft-foreground">
        <TriangleAlert className="mt-0.5 size-[15px] shrink-0" aria-hidden />
        <div className="flex-1 text-[13px]/[1.5]">
          <p>{t.templates.errors[failure.key]}</p>
          {failure.detail ? (
            <p className="mt-1 font-mono text-[12px] break-words">
              {failure.detail}
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <TemplatesList
      templates={toWhatsappTemplateRowViews(result.templates)}
      pageId={pageId}
      t={t}
    />
  )
}

// Sin número de WhatsApp no hay catálogo que mostrar, y el camino no es esta
// pantalla: la plantilla vive en la cuenta de WhatsApp Business del número, así
// que primero hay que conectar uno. El destino es Conexiones y va explícito, no
// como una sugerencia de dónde buscarlo.
function NoNumbersState({ t }: { t: AppDict }) {
  return (
    <section className="mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-card p-[22px] shadow-[var(--shadow-sm)] sm:flex-row sm:items-center">
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-tint)] text-primary"
        aria-hidden
      >
        <MessageCircle className="size-5" />
      </span>
      <div className="flex-1">
        <h2 className="font-heading text-base font-semibold">
          {t.templates.emptyNumbersTitle}
        </h2>
        <p className="mt-1 text-[13.5px]/[1.6] text-muted-foreground">
          {t.templates.emptyNumbersBody}
        </p>
      </div>
      <Button asChild size="lg" className="shrink-0">
        <Link href="/connections">{t.templates.emptyNumbersCta}</Link>
      </Button>
    </section>
  )
}
