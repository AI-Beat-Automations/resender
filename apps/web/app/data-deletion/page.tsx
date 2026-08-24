import Link from "next/link"
import type { Metadata } from "next"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"

export const metadata: Metadata = {
  title: "Data Deletion Instructions",
  description:
    "How to delete your data from Resender, operated by Lorna Suriano Hernandez.",
}

const LAST_UPDATED = "August 24, 2026"
const CONTACT_EMAIL = "info@resender.dev"

export default function DataDeletionPage() {
  return (
    <div className="light flex min-h-svh flex-col">
      <SiteBackground />
      <SiteHeader lang="es" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Data Deletion Instructions
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="grid gap-8 text-sm leading-7 text-muted-foreground">
          <section>
            <p>
              Resender is operated by Lorna Suriano Hernandez. There are two
              ways to delete the data Resender holds about you.
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
                In the{" "}
                <strong className="text-foreground">Delete account</strong>{" "}
                section, retype your account email to confirm and press the
                button.
              </li>
            </ol>
            <p className="mt-3">
              This permanently and immediately deletes your account and all
              associated data. As part of deletion, your connected Pages,
              Instagram accounts and WhatsApp Business Accounts are unsubscribed
              from Meta&rsquo;s webhooks so Resender stops receiving your
              messages.
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
              <li>All connected Instagram accounts and their stored tokens.</li>
              <li>
                All connected WhatsApp Business Accounts (WABA) and phone
                numbers, with their stored access tokens and the encrypted
                two-step verification PIN.
              </li>
              <li>
                All conversations and messages, on every channel, including
                WhatsApp history imported through Coexistence.
              </li>
              <li>
                All WhatsApp media files stored for you — images, video, audio
                and voice notes, documents and stickers — in our private object
                storage.
              </li>
              <li>All API keys.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">
              Timing
            </h2>
            <p>
              Deletion takes effect immediately in production. Backups are
              purged within 30 days.
            </p>
            <p className="mt-3">
              Media files are the exception to &ldquo;immediately&rdquo;. They
              live in object storage and have to be erased one by one, so the
              purge runs as a background job right after your account is
              deleted, and is confirmed separately once the storage provider
              reports the files are gone. To know which files to erase, we keep
              one internal identifier — nothing else about you — until that
              confirmation arrives, and never longer than the 180-day expiry
              that deletes the files anyway. Our{" "}
              <Link
                href="/privacy"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>{" "}
              describes this in full.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">
              If you messaged a business on Messenger, Instagram or WhatsApp
            </h2>
            <p>
              If you sent messages, media or comments to a Facebook Page, an
              Instagram account or a WhatsApp number that uses Resender and want
              that conversation removed, contact the business you were writing
              to (it controls those conversations), or email us at{" "}
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
      <SiteFooter lang="es" />
    </div>
  )
}
