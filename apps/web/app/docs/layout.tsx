import Link from "next/link"
import type { Metadata } from "next"

import { SiteFooter } from "@/components/site-footer"

// Public docs section. Lives as a plain folder under app/ (no middleware exists
// in the repo, so it is public by default) and deliberately stays OUT of the
// (product) route group so no auth gate is applied. Chrome here = back-link
// header + shared footer + a `prose` wrapper; the content is authored in MDX.
export const metadata: Metadata = {
  title: "Integration Docs · Resender",
  description:
    "How external developers integrate with Resender: connect a channel, receive inbound messages at your webhook, and send a reply.",
}

export default function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <header className="mb-10">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-muted-foreground hover:text-foreground"
          >
            Resender
          </Link>
        </header>
        <article className="prose prose-neutral max-w-none dark:prose-invert prose-headings:tracking-tight prose-pre:border prose-pre:border-border prose-pre:bg-muted">
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  )
}
