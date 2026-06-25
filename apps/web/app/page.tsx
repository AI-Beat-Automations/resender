import Link from "next/link"

import { SiteFooter } from "@/components/site-footer"
import { Button } from "@workspace/ui/components/button"

export default function Page() {
  return (
    <div className="flex min-h-svh flex-col bg-[radial-gradient(circle_at_top_left,theme(colors.muted),transparent_34rem)]">
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-6xl flex-col px-6 py-8">
          <header className="flex items-center justify-between">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Resender
            </Link>
            <nav className="flex items-center gap-2">
              <Button asChild variant="ghost">
                <Link href="/login">Login</Link>
              </Button>
              <Button asChild>
                <Link href="/register">Register</Link>
              </Button>
            </nav>
          </header>

          <section className="grid flex-1 items-center gap-10 py-20 md:grid-cols-[1.1fr_0.9fr]">
            <div className="max-w-2xl">
              <p className="mb-4 text-sm font-medium text-muted-foreground">
                Gateway + message log for Messenger
              </p>
              <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
                Receive Facebook messages and reply from your automation.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
                Resender connects your Pages, stores every conversation, and
                delivers messages to your external system with revocable
                credentials.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/register">Create account</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/login">I already have an account</Link>
                </Button>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
              <div className="rounded-2xl bg-muted p-4">
                <div className="mb-5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Incoming message</span>
                  <span>stored</span>
                </div>
                <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-950 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-100">
                  Hi, I&apos;d like to know if you have availability today.
                </div>
                <div className="my-4 h-px bg-border" />
                <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-950 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-100">
                  Your automation replies through Resender&apos;s secure API.
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
