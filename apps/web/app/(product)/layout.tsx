import Link from "next/link"
import { redirect } from "next/navigation"

import { auth, signOut } from "@/auth"
import {
  QuotaNoticeBar,
  type QuotaNoticeView,
} from "@/features/billing/ui/quota-notice-bar"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import type { TenantEntitlement } from "@/lib/billing/entitlements"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { Button } from "@workspace/ui/components/button"
import { SiteLogo } from "@/components/site-logo"
import { ThemeToggle } from "@/components/theme-toggle"

const navItems = [
  { href: "/connections", label: "Connections" },
  { href: "/messages", label: "Messages" },
  { href: "/settings", label: "Settings" },
  { href: "/docs", label: "Docs" },
]

export default async function ProductLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  if (await isUserWaitlisted(session.user.id)) redirect("/waitlist")
  if (!(await hasActiveSubscription(session.user.id))) redirect("/billing")

  // El aviso no debe poder tirar el dashboard: si el entitlement no se puede
  // resolver, la barra simplemente no aparece (los gates del hot path siguen
  // siendo fail-closed por su cuenta).
  let notice: QuotaNoticeView | null = null
  try {
    notice = toQuotaNoticeView(await getTenantEntitlement(session.user.id))
  } catch (error) {
    console.error("quota notice unavailable", error)
  }

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <SiteLogo href="/connections" />
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <form
              action={async () => {
                "use server"
                await signOut({ redirectTo: "/" })
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <QuotaNoticeBar notice={notice} />
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}

function toQuotaNoticeView(
  entitlement: TenantEntitlement
): QuotaNoticeView | null {
  const { notice, block } = entitlement
  if (notice.level === "none") return null

  return {
    level: notice.level,
    usage: notice.usage,
    limit: notice.limit,
    blockCode: block?.code ?? null,
    blockMessage: block?.message ?? null,
  }
}
