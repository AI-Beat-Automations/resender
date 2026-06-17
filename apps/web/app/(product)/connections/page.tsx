import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"

type ConnectedPage = { id: string; name: string }

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string; pages?: string; reason?: string }>
}) {
  const { meta, pages, reason } = await searchParams
  const connected = parseConnectedPages(pages)

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Conecta tus paginas de Facebook. La persistencia de paginas y
          configuracion por pagina llega en el siguiente PR del stack.
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
    </div>
  )
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
