import Link from "next/link"
import type { Metadata } from "next"

import { SiteFooter } from "@/components/site-footer"

export const metadata: Metadata = {
  title: "Terms of Service · Resender",
  description:
    "Terms for businesses using Resender, operated by AI Beat.",
}

const LAST_UPDATED = "June 20, 2026"
const CONTACT_EMAIL = "info@resender.dev"

export default function TermsPage() {
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
            Terms of Service
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
              &ldquo;us&rdquo;). These terms apply to businesses and operators
              that create or use a Resender account.
            </p>
          </Section>

          <Section title="What Resender does">
            <p>
              Resender helps businesses connect Facebook Pages, receive Messenger
              webhooks, store conversation history, forward inbound messages to a
              configured external automation, and send replies through Resender&apos;s
              authenticated API.
            </p>
          </Section>

          <Section title="Your responsibilities">
            <p>
              You are responsible for the Facebook Pages, external automations,
              message content, webhook destinations, API keys, and users you
              connect to Resender. You must have all rights, permissions, and
              notices required to process messages from people who contact your
              Page.
            </p>
          </Section>

          <Section title="Meta platform rules">
            <p>
              You must comply with Meta&apos;s Platform Terms, Messenger Platform
              policies, Community Standards, and any other rules that apply to
              your Facebook Page or Messenger conversations. You may not use
              Resender to bypass Meta policies, rate limits, review requirements,
              messaging windows, or user consent requirements.
            </p>
          </Section>

          <Section title="Acceptable use">
            <p>You may not use Resender to:</p>
            <ul className="ml-5 mt-2 list-disc space-y-1">
              <li>Send spam, deceptive messages, phishing, or unwanted outreach.</li>
              <li>
                Harass, threaten, discriminate against, or exploit any person or
                group.
              </li>
              <li>
                Collect, infer, or process sensitive data without a lawful basis
                and clear user notice.
              </li>
              <li>
                Send illegal, harmful, fraudulent, or misleading content through
                Messenger.
              </li>
              <li>
                Scrape, sell, rent, or misuse Messenger conversation data.
              </li>
              <li>
                Connect webhook destinations that you do not control or that are
                not authorized to receive the relevant messages.
              </li>
            </ul>
          </Section>

          <Section title="External automations">
            <p>
              Resender forwards inbound messages to the webhook URL you configure.
              You are responsible for the security, availability, behavior, and
              legal compliance of that external system. Resender may record
              delivery attempts and errors, but it does not control your external
              automation.
            </p>
          </Section>

          <Section title="Security">
            <p>
              Keep your Resender login credentials and API keys secure. API key
              secrets are shown once and should be stored only in systems you
              control. You must promptly revoke any key that is exposed or no
              longer needed.
            </p>
          </Section>

          <Section title="Data and privacy">
            <p>
              Our{" "}
              <Link
                href="/privacy"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>{" "}
              explains what data Resender handles and how it is used. Our{" "}
              <Link
                href="/data-deletion"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Data Deletion Instructions
              </Link>{" "}
              explain how to delete your account and associated data.
            </p>
          </Section>

          <Section title="Suspension and termination">
            <p>
              We may suspend or terminate access if we reasonably believe an
              account is violating these terms, Meta policies, applicable law, or
              the security and integrity of Resender. You may delete your account
              from Settings or request deletion by email.
            </p>
          </Section>

          <Section title="Service availability">
            <p>
              Resender is provided as an online service and may be unavailable
              during maintenance, outages, provider incidents, or events outside
              our control. We do not guarantee uninterrupted delivery of messages
              to external automations or third-party platforms.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              We may update these terms from time to time. The &ldquo;Last updated&rdquo;
              date above reflects the latest version.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about these terms can be sent to{" "}
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
