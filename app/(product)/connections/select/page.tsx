import Link from "next/link"
import { redirect } from "next/navigation"
import { TriangleAlert } from "lucide-react"

import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import { PageSelectionForm } from "@/features/connect-meta/ui/page-selection-form"
import { resolveSelectionContext } from "@/features/connect-meta/selection-view"
import { getSession } from "@/lib/auth/session"
import { resolveActorCached } from "@/features/clients/queries"
import { listAuthorizedPages, type ConnectedPage } from "@/lib/meta"
import { getMetaUserAccessToken } from "@/lib/pages/meta-user-token"
import { formatPageAllowance } from "@/lib/pages/page-selection"
import { fmt, type AppDict } from "@/content/i18n/app"
import { ConsolePage } from "@/features/shell/ui/console-page"
import { getAppDict } from "@/lib/i18n/app-dict"
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"

// Mock `1g`: columna de 720px, barra de plan, lista clasificada en tarjeta y
// pie con «volver» a la izquierda y el primario a la derecha. Sus cuatro
// estados propios — sin autorización de Meta, plan sin resolver, lista
// clasificada y error de validación al confirmar — se conservan.
export default async function SelectPagesPage() {
  const session = await getSession()
  if (!session?.user?.id) redirect("/login")
  const t = await getAppDict()

  // El actor decide de quién es el cupo y a quién se le marca la fila (issue
  // #154): el padre conecta contra su plan; el cliente, contra su tope, y la
  // fila queda en el tenant del padre con su `client_account_id`. El layout
  // ya rebotó a quien no tiene actor.
  const resolution = await resolveActorCached(session.user.id)
  if (resolution.kind !== "actor") redirect("/connections")
  const { actor } = resolution

  // Sin user access token guardado no hay nada que listar: el usuario todavía
  // no pasó por el diálogo de Meta (o su credencial dejó de ser legible). El
  // token es de quien se logueó en Meta —el user, no el tenant—: un cliente
  // conecta con su propio login.
  const userToken = await getMetaUserAccessToken(actor.userId)
  if (!userToken) {
    return (
      <Shell t={t}>
        <Alert className="flex-col sm:flex-row sm:items-center">
          <AlertContent>
            <AlertTitle>{t.select.noAuthTitle}</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              {t.select.noAuthBody}
            </AlertDescription>
          </AlertContent>
          <ConnectFacebookButton
            label={t.connections.connectFacebook}
            variant="outline"
            size="default"
            className="shrink-0 self-start sm:self-center"
          />
        </Alert>
        <BackLink t={t} />
      </Shell>
    )
  }

  let metaPages: ConnectedPage[]
  try {
    metaPages = await listAuthorizedPages(userToken)
  } catch (error) {
    console.error("meta pages fetch failed", error)
    redirect("/connections?meta=error&reason=meta_session_expired")
  }

  // Plan desconocido = fail-closed, igual que el resto de los gates: no
  // dejamos conectar páginas sin límite resuelto. Al cliente no se le nombra
  // el plan —no es suyo—: ve que no se pudo comprobar su cupo.
  const context = await resolveSelectionContext(
    actor,
    metaPages.map((page) => ({ pageId: page.pageId, name: page.name }))
  )
  if (!context.ok) {
    const isClient = actor.clientAccountId !== null
    return (
      <Shell t={t}>
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertContent>
            <AlertTitle>
              {isClient
                ? t.clientLimits.checkFailed
                : t.select.planUnresolvedTitle}
            </AlertTitle>
            {!isClient && (
              <AlertDescription>{t.select.planUnresolvedBody}</AlertDescription>
            )}
          </AlertContent>
        </Alert>
        <BackLink t={t} />
      </Shell>
    )
  }

  const { view, client } = context

  return (
    <Shell t={t}>
      {/* Cuántas puede añadir, antes de elegir: el mismo texto que devuelve la
          validación del servidor, desde el módulo de dominio. El rango va en
          mono, como en el mock. Para el cliente la cabecera dice «tu tope» y
          los huecos ya vienen acotados por el cupo global del padre. */}
      <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-[13.5px] sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="text-muted-foreground">
            {client ? t.clientLimits.heading : t.select.planHeading} ·{" "}
          </span>
          {t.select.planUsageBefore}
          <span className="font-mono">
            {fmt(t.select.planUsageRange, {
              activePageCount: view.activePageCount,
              maxPages: view.maxPages,
            })}
          </span>
          {t.select.planUsageAfter}
        </p>
        <p className="font-medium">{formatPageAllowance(view, t)}</p>
      </div>
      <PageSelectionForm
        view={view}
        atLimitHint={
          client
            ? fmt(t.clientLimits.selectAtLimitHint, {
                remainingSlots: view.remainingSlots,
              })
            : undefined
        }
      />
    </Shell>
  )
}

function Shell({ children, t }: { children: React.ReactNode; t: AppDict }) {
  return (
    <ConsolePage className="flex max-w-[calc(720px+3rem)] flex-col gap-5">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-[-0.02em]">
          {t.select.title}
        </h1>
        <p className="mt-1.5 text-sm/[1.55] text-muted-foreground">
          {t.select.subtitle}
        </p>
      </header>
      {children}
    </ConsolePage>
  )
}

function BackLink({ t }: { t: AppDict }) {
  return (
    <p>
      <Link
        href="/connections"
        className="text-[13px] text-muted-foreground hover:text-foreground"
      >
        {t.select.back}
      </Link>
    </p>
  )
}
