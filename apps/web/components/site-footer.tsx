import Link from "next/link"

import { SiteLogo } from "@/components/site-logo"

// Footer compartido de la superficie pública (landing, pricing, blog, auth y
// páginas legales). No se monta en el área de producto autenticada.
const columns = [
  {
    title: "Producto",
    links: [
      { href: "/pricing", label: "Precios", external: false },
      { href: "/blog", label: "Blog", external: false },
      { href: "/docs", label: "Docs", external: false },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacidad", external: false },
      { href: "/terms", label: "Términos", external: false },
      { href: "/data-deletion", label: "Eliminación de datos", external: false },
    ],
  },
  {
    title: "Contacto",
    links: [
      { href: "mailto:info@resender.dev", label: "info@resender.dev", external: true },
      // TODO: reemplazar por la invitación real de Discord cuando exista.
      { href: "https://discord.gg", label: "Discord", external: true },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div className="space-y-3">
            <SiteLogo />
            <p className="max-w-xs text-sm text-muted-foreground">
              La API relay para mensajes de Meta. Simple y developer-first.
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="mb-3 text-sm font-semibold">{column.title}</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {column.links.map((link) =>
                  link.external ? (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="transition-colors hover:text-foreground"
                        target={link.href.startsWith("http") ? "_blank" : undefined}
                        rel={
                          link.href.startsWith("http")
                            ? "noreferrer noopener"
                            : undefined
                        }
                      >
                        {link.label}
                      </a>
                    </li>
                  ) : (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} AI Beat · Resender</p>
        </div>
      </div>
    </footer>
  )
}
