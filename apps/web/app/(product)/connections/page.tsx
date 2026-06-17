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
  const session = await auth()
  const tenantPages = session?.user?.id
    ? await listTenantPages(session.user.id)
    : []

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Conecta tus paginas de Facebook, configura un webhook por pagina y
          desconecta canales sin borrar el historial.
        </p>
      </div>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-medium">Facebook</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Autoriza tus paginas desde Meta para empezar el onboarding.
        </p>
        <div className="mt-4">
          <ConnectFacebookButton />
        </div>
        {meta === "connected" && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-950 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-100">
            <p>
              Conectado: {connected.length} pagina
              {connected.length === 1 ? "" : "s"} autorizada
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
            No se pudo conectar{reason ? `: ${reason}` : ""}.
          </p>
        )}
      </section>
      <section className="grid gap-3">
        <div>
          <h2 className="font-medium">Paginas conectadas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Las reconexiones actualizan token y metadata sin duplicar paginas.
          </p>
        </div>
        {tenantPages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
            Todavia no hay paginas conectadas para este tenant.
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

function toPageView(page: Awaited<ReturnType<typeof listTenantPages>>[number]): ConnectedPageView {
  return {
    id: page.id,
    metaPageId: page.metaPageId,
    name: page.name,
    status: page.status,
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
