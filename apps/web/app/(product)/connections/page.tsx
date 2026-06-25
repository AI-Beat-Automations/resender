import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import {
  ConnectedPageCard,
  type ConnectedPageView,
} from "@/features/connections/ui/connected-page-card"
import { auth } from "@/auth"
import { listTenantPages } from "@/lib/pages/page-registry"

type ConnectedPage = { id: string; name: string }

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string; pages?: string; reason?: string }>
}) {
  const { meta, pages, reason } = await searchParams
  const connected = parseConnectedPages(pages)
  const errorMessage = formatMetaConnectionError(reason)
  const session = await auth()
  const tenantPages = session?.user?.id
    ? await listTenantPages(session.user.id)
    : []

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Connect your Facebook Pages, configure a webhook per Page, and
          disconnect channels without deleting history.
        </p>
      </div>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-medium">Facebook</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Authorize your Pages from Meta to start onboarding.
        </p>
        <div className="mt-4">
          <ConnectFacebookButton />
        </div>
        {meta === "connected" && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-950 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-100">
            <p>
              Connected: {connected.length} Page
              {connected.length === 1 ? "" : "s"} authorized
              {connected.length > 0 ? ":" : "."}
            </p>
            {connected.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {connected.map((page) => (
                  <li key={page.id}>
                    {page.name} ({page.id})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {meta === "error" && (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </p>
        )}
      </section>
      <section className="grid gap-3">
        <div>
          <h2 className="font-medium">Connected Pages</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reconnections update token and metadata without duplicating Pages.
          </p>
        </div>
        {tenantPages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
            No Pages connected for this tenant yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {tenantPages.map((page) => (
              <ConnectedPageCard key={page.id} page={toPageView(page)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function toPageView(
  page: Awaited<ReturnType<typeof listTenantPages>>[number]
): ConnectedPageView {
  return {
    id: page.id,
    metaPageId: page.metaPageId,
    name: page.name,
    status: page.status,
    tokenStatus: page.tokenStatus,
    tokenError: page.tokenError,
    tokenErrorAt: page.tokenErrorAt?.toISOString() ?? null,
    webhookUrl: page.webhookUrl,
    connectedAt: page.connectedAt.toISOString(),
    disconnectedAt: page.disconnectedAt?.toISOString() ?? null,
  }
}

function parseConnectedPages(pages?: string): ConnectedPage[] {
  if (!pages) return []

  try {
    const parsed = JSON.parse(pages) as ConnectedPage[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (page) => typeof page.id === "string" && typeof page.name === "string"
    )
  } catch {
    return []
  }
}

function formatMetaConnectionError(reason?: string) {
  if (reason === "webhook_subscription_failed") {
    return "Couldn't connect: Meta didn't confirm the webhook subscription for all Pages. No Page was saved as connected."
  }

  if (reason?.startsWith("page_owned:")) {
    const pageId = reason.split(":")[1]
    return `Couldn't connect: Page ${pageId} already belongs to another Resender account.`
  }

  if (reason === "configuration_failed") {
    return "Couldn't connect: server secret encryption isn't configured."
  }

  if (reason === "state_mismatch") {
    return "Couldn't connect: the authorization session expired or doesn't match. Please try again."
  }

  return reason ? `Couldn't connect: ${reason}.` : "Couldn't connect."
}
