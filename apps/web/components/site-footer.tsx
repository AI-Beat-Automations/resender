import Link from "next/link"

import { SiteLogo } from "@/components/site-logo"
import {
  DISCORD_INVITE_URL,
  DOCS_URL,
  SITE_CONTACT_EMAIL,
  SITE_CONTACT_EMAIL_HREF,
} from "@/lib/site-config"
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
          href: localePath("/vs-manychat", lang),
          label: dict.footer.links.vsManychat,
          external: false,
        },
        {
          href: localePath("/blog", lang),
          label: dict.footer.links.blog,
          external: false,
        },
        { href: DOCS_URL, label: dict.footer.links.docs, external: true },
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
          href: SITE_CONTACT_EMAIL_HREF,
          label: SITE_CONTACT_EMAIL,
          external: true,
        },
        // Discord: se muestra recién cuando exista la invitación real. Un
        // `https://discord.gg` pelado es un link muerto en producción, y los
        // enlaces rotos del footer pesan en cada página del sitio.
        ...(DISCORD_INVITE_URL
          ? [{ href: DISCORD_INVITE_URL, label: "Discord", external: true }]
          : []),
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
