import Link from "next/link"
import { redirect } from "next/navigation"

import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import { PageSelectionForm } from "@/features/connect-meta/ui/page-selection-form"
import { auth } from "@/auth"
import { resolvePlanLimits } from "@/lib/billing/entitlements"
import { getSubscriptionByTenantId } from "@/lib/billing/subscription"
import { listAuthorizedPages, type ConnectedPage } from "@/lib/meta"
import { getMetaUserAccessToken } from "@/lib/pages/meta-user-token"
import { countActivePages, getPageOwnership } from "@/lib/pages/page-registry"
import { classifyPagesForSelection } from "@/lib/pages/page-selection"

export default async function SelectPagesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const tenantId = session.user.id

  // Sin user access token guardado no hay nada que listar: el usuario todavía
  // no pasó por el diálogo de Meta (o su credencial dejó de ser legible).
  const userToken = await getMetaUserAccessToken(tenantId)
  if (!userToken) {
    return (
      <Shell>
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="font-medium">Authorize Meta first</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We need your Meta authorization to list the Pages you administer.
            Connect Facebook and you&apos;ll come back here to pick which Pages
            to connect.
          </p>
          <div className="mt-4">
            <ConnectFacebookButton />
          </div>
        </section>
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
      <Shell>
        <section className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          <p className="font-medium">We couldn&apos;t resolve your plan.</p>
          <p className="mt-1">
            Contact support at info@resender.dev so we can review your
            subscription before connecting Pages.
          </p>
        </section>
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
    <Shell>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-medium">Your plan</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {view.activePageCount} of {view.maxPages} Pages connected.{" "}
          {view.remainingSlots === 0
            ? "No slots left: disconnect a Page in Connections to add another one."
            : `You can add ${view.remainingSlots} more Page${
                view.remainingSlots === 1 ? "" : "s"
              }.`}
        </p>
      </section>
      <PageSelectionForm view={view} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Select Pages</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Choose which of the Pages you administer on Facebook you want to
          connect to Resender.
        </p>
      </div>
      {children}
      <div>
        <Link
          href="/connections"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Back to Connections
        </Link>
      </div>
    </div>
  )
}
