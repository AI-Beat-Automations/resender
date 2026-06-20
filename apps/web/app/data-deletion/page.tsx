import Link from "next/link"
import type { Metadata } from "next"

import { SiteFooter } from "@/components/site-footer"

export const metadata: Metadata = {
  title: "Data Deletion Instructions · Resender",
  description: "How to delete your data from Resender, operated by AI Beat.",
}

const LAST_UPDATED = "June 18, 2026"
const CONTACT_EMAIL = "info@resender.dev"

export default function DataDeletionPage() {
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
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">
            Data Deletion Instructions
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="grid gap-8 text-sm leading-7 text-muted-foreground">
          <section>
            <p>
              Resender is operated by AI Beat. There are two ways to delete the
              data Resender holds about you.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">
              Option 1 — Delete it yourself (immediate)
            </h2>
            <ol className="ml-5 list-decimal space-y-1">
              <li>Log in to your Resender account.</li>
              <li>
                Go to <strong className="text-foreground">Settings</strong>.
              </li>
              <li>
                In the <strong className="text-foreground">Eliminar cuenta</strong>{" "}
                (Delete account) section, retype your account email to confirm and
                press the button.
              </li>
            </ol>
            <p className="mt-3">
              This permanently and immediately deletes your account and all
              associated data. As part of deletion, your connected Pages are
              unsubscribed from Meta&rsquo;s webhook so Resender stops receiving
              your messages.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">
              Option 2 — Ask us by email
            </h2>
            <p>
              If you cannot log in, email us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>{" "}
              from your account email and ask for deletion. We complete these
              requests within 30 days.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">
              What gets deleted
            </h2>
            <ul className="ml-5 list-disc space-y-1">
              <li>Your account (email and credentials).</li>
              <li>All connected Facebook Pages and their stored tokens.</li>
              <li>All conversations and messages.</li>
              <li>All API keys.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">
              Timing
            </h2>
            <p>
              Deletion takes effect immediately in production. Backups are purged
              within 30 days.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">
              If you messaged a business on Messenger
            </h2>
            <p>
              If you sent messages to a Facebook Page that uses Resender and want
              that conversation removed, contact the business that operates the
              Page (they control those conversations), or email us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>{" "}
              and we will coordinate the deletion with our customer.
            </p>
          </section>

          <section>
            <p>
              See our{" "}
              <Link
                href="/privacy"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>{" "}
              for the full data inventory.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
