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
import { getAppDict } from "@/lib/i18n/app-dict"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

// v2 no dibuja esta pantalla (ADR 0005): se resuelve con el lenguaje del mock
// 1g y sus cuatro estados propios — sin autorización de Meta, plan sin
// resolver, lista clasificada y error de validación al confirmar. El
// breadcrumb «Consola › Conexiones › Elegir páginas» lo pone el header del
// shell, así que acá solo va el título y el cuerpo.
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
        <BlockingNotice
          title={t.select.noAuthTitle}
          body={t.select.noAuthBody}
          reauthorizeLabel={t.connections.connectFacebook}
        />
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
        <BlockingNotice
          title={t.select.planUnresolvedTitle}
          body={t.select.planUnresolvedBody}
          reauthorizeLabel={t.connections.connectFacebook}
        />
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
          validación del servidor, desde el módulo de dominio. Es una nota, no
          una alerta: no hay nada que corregir. */}
      <Alert
        role="note"
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-sunken px-4 py-3 text-[13.5px]"
      >
        <AlertTitle className="font-normal">
          <span className="text-muted-foreground">
            {t.select.planHeading} ·{" "}
          </span>
          {fmt(t.select.planUsage, {
            activePageCount: view.activePageCount,
            maxPages: view.maxPages,
          })}
        </AlertTitle>
        <AlertDescription className="text-[13.5px] font-medium text-foreground">
          {formatPageAllowance(view, t)}
        </AlertDescription>
      </Alert>
      <PageSelectionForm view={view} />
    </Shell>
  )
}

function Shell({ children, t }: { children: React.ReactNode; t: AppDict }) {
  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-[-0.02em]">
          {t.select.title}
        </h1>
        <p className="mt-1.5 text-sm/[1.55] text-muted-foreground">
          {t.select.subtitle}
        </p>
      </header>
      {children}
    </div>
  )
}

// Los dos estados que impiden listar: sin autorización de Meta y plan sin
// resolver. Los dos se salen por el mismo sitio —volver a autorizar— porque el
// endpoint de Facebook es también el que refresca la credencial.
function BlockingNotice({
  title,
  body,
  reauthorizeLabel,
}: {
  title: string
  body: string
  reauthorizeLabel: string
}) {
  return (
    <Alert
      variant="destructive"
      className="items-center px-4 py-3.5 has-[>svg]:grid-cols-[auto_1fr_auto] has-[>svg]:gap-x-3"
    >
      <TriangleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
      <ConnectFacebookButton
        label={reauthorizeLabel}
        size="sm"
        className="col-start-3 row-span-2 row-start-1 self-center"
      />
    </Alert>
  )
}

function BackLink({ t }: { t: AppDict }) {
  return (
    <div>
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
      >
        <Link href="/connections">{t.select.back}</Link>
      </Button>
    </div>
  )
}
