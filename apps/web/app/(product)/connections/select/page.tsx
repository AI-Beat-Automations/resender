import Link from "next/link"
import { redirect } from "next/navigation"
import { TriangleAlert } from "lucide-react"

import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import { PageSelectionForm } from "@/features/connect-meta/ui/page-selection-form"
import { getSession } from "@/lib/auth/session"
import { resolvePlanLimits } from "@/lib/billing/entitlements"
import { getSubscriptionByTenantId } from "@/lib/billing/subscription"
import { listAuthorizedPages, type ConnectedPage } from "@/lib/meta"
import { getMetaUserAccessToken } from "@/lib/pages/meta-user-token"
import { countActivePages, getPageOwnership } from "@/lib/pages/page-registry"
import {
  classifyPagesForSelection,
  formatPageAllowance,
} from "@/lib/pages/page-selection"
import { fmt, type AppDict } from "@/content/i18n/app"
import { ConsolePage } from "@/features/shell/ui/console-page"
import { getAppDict } from "@/lib/i18n/app-dict"
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"

// Mock `1g`: columna de 720px, barra de plan, lista clasificada en tarjeta y
// pie con «volver» a la izquierda y el primario a la derecha. Sus cuatro
// estados propios — sin autorización de Meta, plan sin resolver, lista
// clasificada y error de validación al confirmar — se conservan.
export default async function SelectPagesPage() {
  const session = await getSession()
  if (!session?.user?.id) redirect("/login")
  const tenantId = session.user.id
  const t = await getAppDict()

  // Sin user access token guardado no hay nada que listar: el usuario todavía
  // no pasó por el diálogo de Meta (o su credencial dejó de ser legible).
  const userToken = await getMetaUserAccessToken(tenantId)
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

  const [subscription, activePageCount, ownership] = await Promise.all([
    getSubscriptionByTenantId(tenantId),
    countActivePages(tenantId),
    getPageOwnership(metaPages.map((page) => page.pageId)),
  ])

  // Plan desconocido = fail-closed, igual que el resto de los gates: no
  // dejamos conectar páginas sin límite resuelto.
  const limits = resolvePlanLimits(subscription?.priceLookupKey ?? null)
  if (!limits) {
    return (
      <Shell t={t}>
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertContent>
            <AlertTitle>{t.select.planUnresolvedTitle}</AlertTitle>
            <AlertDescription>{t.select.planUnresolvedBody}</AlertDescription>
          </AlertContent>
        </Alert>
        <BackLink t={t} />
      </Shell>
    )
  }

  const view = classifyPagesForSelection({
    metaPages: metaPages.map((page) => ({
      pageId: page.pageId,
      name: page.name,
    })),
    ownership,
    tenantId,
    activePageCount,
    maxPages: limits.maxPages,
  })

  return (
    <Shell t={t}>
      {/* Cuántas puede añadir, antes de elegir: el mismo texto que devuelve la
          validación del servidor, desde el módulo de dominio. El rango va en
          mono, como en el mock. */}
      <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-[13.5px] sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="text-muted-foreground">
            {t.select.planHeading} ·{" "}
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
      <PageSelectionForm view={view} />
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
