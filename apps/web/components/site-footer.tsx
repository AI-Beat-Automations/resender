import Link from "next/link"

import { SiteLogo } from "@/components/site-logo"
import { getDictionary, localePath, type Locale } from "@/content/i18n"

// Footer compartido de la superficie pública (landing, pricing, blog, auth y
// páginas legales). Destacado con color de contraste (`bg-foreground` /
// `text-background`): morado oscuro en modo claro, crema en modo oscuro.
//
// Solo se localizan las rutas de producto. `/docs` y las páginas legales quedan
// en la raíz: existen en un solo idioma.
export function SiteFooter({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)

  const columns = [
    {
      title: dict.footer.columns.product,
      links: [
        {
          href: localePath("/pricing", lang),
          label: dict.footer.links.pricing,
          external: false,
        },
        {
          href: localePath("/blog", lang),
          label: dict.footer.links.blog,
          external: false,
        },
        { href: "/docs", label: dict.footer.links.docs, external: false },
      ],
    },
    {
      title: dict.footer.columns.legal,
      links: [
        { href: "/privacy", label: dict.footer.links.privacy, external: false },
        { href: "/terms", label: dict.footer.links.terms, external: false },
        {
          href: "/data-deletion",
          label: dict.footer.links.dataDeletion,
          external: false,
        },
      ],
    },
    {
      title: dict.footer.columns.contact,
      links: [
        {
          href: "mailto:info@resender.dev",
          label: "info@resender.dev",
          external: true,
        },
        // TODO: reemplazar por la invitación real de Discord cuando exista.
        { href: "https://discord.gg", label: "Discord", external: true },
      ],
    },
  ]

  return (
    <footer className="bg-foreground text-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div className="space-y-3">
            <SiteLogo href={localePath("/", lang)} label={dict.nav.home} />
            <p className="max-w-xs text-sm text-background/70">
              {dict.footer.tagline}
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="mb-3 text-sm font-semibold">{column.title}</h3>
              <ul className="space-y-2 text-sm text-background/70">
                {column.links.map((link) =>
                  link.external ? (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="transition-colors hover:text-background"
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
                        className="transition-colors hover:text-background"
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

        <div className="mt-10 border-t border-background/20 pt-6 text-sm text-background/70">
          <p>© {new Date().getFullYear()} AI Beat · Resender</p>
        </div>
      </div>
    </footer>
  )
}
