"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowUpRight,
  BookOpen,
  Inbox,
  Link2,
  LogOut,
  Settings,
  type LucideIcon,
} from "lucide-react"

import { SignOutForm } from "@/components/sign-out-form"
import { ThemeToggle } from "@/components/theme-toggle"
import { initialsFromEmail } from "@/lib/account/initials"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

// Shell del producto (ADR 0005): sidebar fijo de 240 px que reemplaza al header
// sticky. Cuatro destinos planos, sin grupos, y al pie tema + identidad.
// Es cliente por `usePathname()`, así que la server action de cerrar sesión
// llega por props desde el layout.

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  external?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: "/connections", label: "Conexiones", icon: Link2 },
  { href: "/messages", label: "Mensajes", icon: Inbox },
  { href: "/settings", label: "Ajustes", icon: Settings },
  { href: "/docs", label: "Documentación", icon: BookOpen, external: true },
]

export function AppSidebar({
  email,
  signOutAction,
}: {
  email: string
  signOutAction: () => Promise<void>
}) {
  const pathname = usePathname()

  return (
    <aside className="flex h-svh w-[var(--sidebar-w)] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 pt-5 pb-3.5">
      {/* Wordmark: `site-logo.tsx` es del sitio público (capitalizado, 18px,
          `.dev` en bold) y no coincide con el del sidebar, así que va inline. */}
      <Link
        href="/connections"
        aria-label="Resender.dev — inicio"
        className="inline-flex items-baseline px-2.5 font-heading text-[17px] font-bold tracking-[-0.02em] text-foreground"
      >
        resender
        <span className="font-mono text-[14px] font-normal text-primary">
          .dev
        </span>
      </Link>

      <nav className="mt-6 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          // La documentación nunca se marca activa: sale de la consola.
          const active = !item.external && isActiveRoute(pathname, item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-[9px] text-sm",
                active
                  ? "bg-card font-semibold text-foreground shadow-[var(--shadow-xs),var(--ring-hairline)]"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "size-4",
                  active ? "text-primary" : "text-[var(--text-subtle)]"
                )}
                aria-hidden
              />
              <span className="flex-1">{item.label}</span>
              {item.external ? (
                <ArrowUpRight
                  className="size-[13px] text-[var(--text-subtle)]"
                  aria-hidden
                />
              ) : null}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex items-center justify-between px-2.5">
          <span className="font-mono text-[11px] text-[var(--text-subtle)]">
            tema
          </span>
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-2.5 border-t border-sidebar-border pt-3 pl-1.5">
          <span
            className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-primary font-heading text-[12px] font-semibold text-primary-foreground"
            aria-hidden
          >
            {initialsFromEmail(email)}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground"
            title={email}
          >
            {email}
          </span>
          {/* `SignOutForm` hace el `posthog.reset()` antes de la server action:
              sin él la identidad del usuario anterior sobrevive al logout. */}
          <SignOutForm action={signOutAction}>
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <LogOut className="size-[15px]" aria-hidden />
            </Button>
          </SignOutForm>
        </div>
      </div>
    </aside>
  )
}

// Coincidencia por segmento: `/connections` marca `/connections/select`, pero
// `/connections-x` no, y `/messages` solo marca lo suyo.
function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
