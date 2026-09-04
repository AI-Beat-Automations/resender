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
import { useAppDict } from "@/content/i18n/app/provider"
import { accountInitials } from "@/lib/account/initials"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

// Shell de la consola (ADR 0015): bloque `Sidebar` de shadcn, fijo y sin
// colapso, con dos grupos (CONSOLA / RECURSOS) y al pie tema + identidad.
// Es cliente por `usePathname()` (en `NavGroup`), así que la server action de
// cerrar sesión llega por props desde el layout.

type NavItem = {
  href: string
  /** Clave del bloque `shell` del diccionario, no el texto ya resuelto. */
  label: "navConnections" | "navInbox" | "navSettings" | "navDocs"
  icon: LucideIcon
  external?: boolean
}

const CONSOLE_ITEMS: NavItem[] = [
  { href: "/connections", label: "navConnections", icon: Link2 },
  { href: "/inbox", label: "navInbox", icon: Inbox },
  { href: "/settings", label: "navSettings", icon: Settings },
]

const RESOURCE_ITEMS: NavItem[] = [
  { href: "/docs", label: "navDocs", icon: BookOpen, external: true },
]

export function AppSidebar({
  name,
  email,
  signOutAction,
}: {
  /** Puede venir vacío: las cuentas anteriores al alta con nombre. */
  name: string
  email: string
  signOutAction: () => Promise<void>
}) {
  const t = useAppDict().shell

  return (
    <Sidebar
      collapsible="none"
      className="h-svh shrink-0 border-r border-sidebar-border p-3"
    >
      <SidebarHeader className="mb-3.5 p-0">
        {/* Wordmark: `site-logo.tsx` es del sitio público y no coincide con el
            del sidebar (cuadro «r» + nombre), así que va inline. */}
        <Link
          href="/connections"
          aria-label={t.home}
          className="flex h-10 items-center gap-2.5 px-2 text-foreground"
        >
          <span
            className="flex size-7 items-center justify-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground"
            aria-hidden
          >
            r
          </span>
          <span className="flex items-baseline font-heading text-base font-bold tracking-[-0.02em]">
            Resender
            <span className="font-mono text-[12.5px] font-normal text-primary">
              .dev
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <NavGroup label={t.groupConsole} items={CONSOLE_ITEMS} />
        <NavGroup label={t.groupResources} items={RESOURCE_ITEMS} />
      </SidebarContent>

      <SidebarFooter className="gap-3 p-0">
        <div className="flex items-center justify-between px-2.5">
          <span className="font-mono text-[11px] text-[var(--text-subtle)]">
            {t.theme}
          </span>
          <ThemeToggle />
        </div>

        <Card
          size="sm"
          className="flex-row items-center gap-2.5 rounded-[10px] p-2 [--card-spacing:0]"
        >
          <Avatar className="size-[30px]">
            <AvatarFallback className="text-[11px] font-semibold text-foreground">
              {accountInitials(name, email)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-foreground">
              {name || email}
            </span>
            <span
              className="block truncate text-[11.5px] text-muted-foreground"
              title={email}
            >
              {email}
            </span>
          </span>
          {/* `SignOutForm` hace el `posthog.reset()` antes de la server action:
              sin él la identidad del usuario anterior sobrevive al logout. */}
          <SignOutForm action={signOutAction}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.signOut}
                  className="text-muted-foreground"
                >
                  <LogOut className="size-[15px]" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.signOut}</TooltipContent>
            </Tooltip>
          </SignOutForm>
        </Card>
      </SidebarFooter>
    </Sidebar>
  )
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname()
  const t = useAppDict().shell

  return (
    <SidebarGroup className="p-0 pb-1">
      {/* Etiqueta de grupo en mono, como el mock. */}
      <SidebarGroupLabel className="h-auto px-2.5 pt-0 pb-1.5 font-mono text-[10.5px] font-normal tracking-[.06em] text-[var(--text-subtle)]">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {items.map((item) => {
            // La documentación nunca se marca activa: sale de la consola.
            const active = !item.external && isActiveRoute(pathname, item.href)
            const Icon = item.icon

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  className="h-[34px] gap-2.5 px-2.5 text-[13.5px] text-[var(--text-body)]/80 data-active:bg-sidebar-accent data-active:font-medium data-active:text-foreground"
                >
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                  >
                    <Icon
                      className={cn(
                        active ? "text-foreground" : "text-muted-foreground"
                      )}
                      aria-hidden
                    />
                    <span className="flex-1">{t[item.label]}</span>
                    {item.external ? (
                      <ArrowUpRight
                        className="size-3! text-[var(--text-subtle)]"
                        aria-hidden
                      />
                    ) : null}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

// Coincidencia por segmento: `/connections` marca `/connections/select`, pero
// `/connections-x` no, y `/inbox` solo marca lo suyo.
function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
