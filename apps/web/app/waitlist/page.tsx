import Link from "next/link"
import { redirect } from "next/navigation"
import { Clock3 } from "lucide-react"

import { auth, signOut } from "@/auth"
import { SiteFooter } from "@/components/site-footer"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { Button } from "@workspace/ui/components/button"
import { privatePageMetadata } from "@/lib/seo"
import { DOCS_URL } from "@/lib/site-config"

export const metadata = privatePageMetadata("Waitlist")

// Landing zone for accounts that registered while the product is closed.
// Lives outside the `(product)` group on purpose: that layout bounces
// waitlisted users here, so this page must not be wrapped by it.
export default async function WaitlistPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  if (!(await isUserWaitlisted(session.user.id))) redirect("/connections")

  return (
    <div className="flex min-h-svh flex-col bg-[radial-gradient(circle_at_top_left,theme(colors.muted),transparent_34rem)]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-8">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Resender
        </Link>
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/" })
          }}
        >
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-12">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-sm">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Clock3 className="size-5" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            You&apos;re on the waitlist
          </h1>
          <p className="mt-3 text-muted-foreground">
            Your account is created and your spot is saved. Resender is opening
            access gradually, and we&apos;ll email you as soon as yours is
            ready.
          </p>
          <div className="mt-6 rounded-xl border border-border bg-muted/50 p-4 text-sm">
            <p className="text-muted-foreground">We&apos;ll write to</p>
            <p className="mt-1 font-medium">{session.user.email}</p>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            In the meantime you can read the{" "}
            <a
              href={DOCS_URL}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              integration docs
            </a>{" "}
            to see how Resender connects to your automation, or reach us at{" "}
            <a
              href="mailto:info@resender.dev"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              info@resender.dev
            </a>
            .
          </p>
        </div>
      </main>
      <SiteFooter lang="es" />
    </div>
  )
}
