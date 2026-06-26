import Link from "next/link"

// Footer compartido de la superficie pública (landing, auth y páginas legales).
// No se monta en el área de producto autenticada.
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© AI Beat · Resender</p>
        <nav className="flex flex-wrap items-center gap-4">
          <Link href="/docs" className="hover:text-foreground">
            Docs
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/data-deletion" className="hover:text-foreground">
            Data Deletion
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <a
            href="mailto:info@resender.dev"
            className="hover:text-foreground"
          >
            info@resender.dev
          </a>
        </nav>
      </div>
    </footer>
  )
}
