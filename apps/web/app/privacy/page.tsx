import Link from "next/link"
import type { Metadata } from "next"

import { SiteFooter } from "@/components/site-footer"

export const metadata: Metadata = {
  title: "Privacy Policy · Resender",
  description:
    "How Resender, operated by AI Beat, handles account and Messenger data.",
}

const LAST_UPDATED = "June 18, 2026"
const CONTACT_EMAIL = "info@resender.dev"

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="grid gap-8 text-sm leading-7 text-muted-foreground">
          <Section title="Who we are">
            <p>
              Resender is a Messenger gateway and durable message log operated by{" "}
              <strong className="text-foreground">AI Beat</strong> (&ldquo;we&rdquo;,
              &ldquo;us&rdquo;). Resender is the product; AI Beat is the company
              responsible for it. AI Beat operates from Mexico. This policy
              explains what data we handle, how we use it, who we share it with,
              and how to have it deleted.
            </p>
          </Section>

          <Section title="Our role: controller and processor">
            <p>
              We handle two classes of data with two different roles:
            </p>
            <ul className="ml-5 mt-2 list-disc space-y-1">
              <li>
                <strong className="text-foreground">Account data</strong> of our
                customers (the businesses that sign up for Resender, &ldquo;tenants&rdquo;):
                AI Beat is the data controller (responsable).
              </li>
              <li>
                <strong className="text-foreground">Messenger end-user data</strong> —
                the messages people send to a customer&rsquo;s connected Facebook
                Page: AI Beat acts as a processor (encargado) on behalf of that
                customer, who is the controller of those conversations.
              </li>
            </ul>
          </Section>

          <Section title="Data we handle">
            <p className="font-medium text-foreground">Account data</p>
            <ul className="ml-5 mt-1 list-disc space-y-1">
              <li>Your email address and a hashed password.</li>
              <li>
                Connected Facebook Pages: page name and id, the Page access token
                (stored encrypted), and an optional webhook URL you configure.
              </li>
              <li>
                API keys you create for external integrations: stored only as a
                hash plus a short visible prefix. The full secret is shown once,
                at creation, and never again.
              </li>
            </ul>
            <p className="mt-4 font-medium text-foreground">
              Messenger end-user data
            </p>
            <ul className="ml-5 mt-1 list-disc space-y-1">
              <li>The contact&rsquo;s page-scoped id (PSID) and optional name.</li>
              <li>
                Message content, direction (inbound/outbound) and status, the
                Meta message id, the provider response, and delivery metadata for
                messages we forward to your external system.
              </li>
            </ul>
          </Section>

          <Section title="How we use data">
            <p>
              We use this data only to operate the service: to receive and store
              incoming messages, forward them to the customer&rsquo;s configured
              external system, send outgoing replies through Meta, authenticate
              API access, and keep the message log available to the customer. We
              do not sell data and we do not use it for advertising.
            </p>
          </Section>

          <Section title="How we protect it">
            <p>
              Page access tokens are encrypted at rest. API key secrets are stored
              as hashes, never in clear text. Authentication uses a single
              functional session cookie.
            </p>
          </Section>

          <Section title="Where data is stored and who processes it">
            <p>
              Resender is hosted on Vercel, with a PostgreSQL database on Neon.
              Data is stored in the United States. AI Beat operates from Mexico.
            </p>
            <p className="mt-2">Our sub-processors are:</p>
            <ul className="ml-5 mt-1 list-disc space-y-1">
              <li>
                <strong className="text-foreground">Meta Platforms</strong> —
                message delivery through the Messenger Platform.
              </li>
              <li>
                <strong className="text-foreground">Vercel</strong> — application
                hosting.
              </li>
              <li>
                <strong className="text-foreground">Neon</strong> — managed
                PostgreSQL database.
              </li>
            </ul>
          </Section>

          <Section title="Cookies and tracking">
            <p>
              We use no analytics and no third-party trackers. The only cookie is
              the functional session cookie used to keep you signed in. Fonts are
              self-hosted, so loading the site makes no third-party font request.
            </p>
          </Section>

          <Section title="Data retention">
            <p>
              We keep your data while your account is active. Disconnecting a Page
              stops future message traffic but preserves the existing conversation
              history as a log. Deleting your account removes everything (see
              below).
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              You can request access to, correction of, or deletion of your data,
              and opt out of further processing. To exercise these rights, use the
              self-serve <strong className="text-foreground">Delete account</strong>{" "}
              option in Settings, or email us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section title="Deleting your data">
            <p>
              See our{" "}
              <Link
                href="/data-deletion"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Data Deletion Instructions
              </Link>
              . In short: log in, go to Settings and choose Delete account for an
              immediate, permanent deletion of your account and all associated
              data; or email {CONTACT_EMAIL} and we will delete it within 30 days.
              Backups are purged within 30 days.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              We may update this policy. The &ldquo;Last updated&rdquo; date above
              reflects the latest version.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              For privacy questions, data-deletion requests, or to report a
              security vulnerability, contact{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}
