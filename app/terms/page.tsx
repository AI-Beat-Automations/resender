import Link from "next/link"
import type { Metadata } from "next"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms for businesses using Resender, operated by Lorna Suriano Hernandez.",
}

const LAST_UPDATED = "August 24, 2026"
const CONTACT_EMAIL = "info@resender.dev"

export default function TermsPage() {
  return (
    <div className="light flex min-h-svh flex-col">
      <SiteBackground />
      <SiteHeader lang="es" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="grid gap-8 text-sm leading-7 text-muted-foreground">
          <Section title="Who we are">
            <p>
              Resender is a messaging gateway and durable message log for
              Messenger, Instagram and WhatsApp, operated by{" "}
              <strong className="text-foreground">
                Lorna Suriano Hernandez
              </strong>{" "}
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;). These terms apply to
              businesses and operators that create or use a Resender account.
            </p>
          </Section>

          <Section title="What Resender does">
            <p>
              Resender helps businesses connect Facebook Pages, Instagram
              accounts and WhatsApp business numbers, receive webhooks from
              Meta, store conversation history, forward inbound messages to a
              configured external automation, and send replies through
              Resender&apos;s authenticated API.
            </p>
          </Section>

          <Section title="Your responsibilities">
            <p>
              You are responsible for the Facebook Pages, Instagram accounts,
              WhatsApp numbers, external automations, message content, media,
              webhook destinations, API keys, and users you connect to Resender.
              You must have all rights, permissions, and notices required to
              process messages from people who contact you.
            </p>
            <p className="mt-2">
              Automations are yours. Resender delivers what your system decides
              to send, and it cannot review it first: the wording, timing,
              frequency and legality of every automated reply are your
              responsibility, as is any file you send. You must hold the rights
              to the media you send, and it must be lawful and appropriate for
              the person receiving it.
            </p>
          </Section>

          <Section title="WhatsApp: opt-in and the 24-hour window">
            <p>
              WhatsApp is not an outreach channel in Resender. Two rules follow
              from that, and they are conditions of use, not settings:
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                <strong className="text-foreground">
                  You need the person&apos;s opt-in.
                </strong>{" "}
                You may only handle WhatsApp conversations with people who have
                agreed to be contacted by your business on WhatsApp, and you
                must be able to show that agreement. Contact details obtained
                without consent, bought, scraped or repurposed from another
                channel do not qualify.
              </li>
              <li>
                <strong className="text-foreground">
                  The end user has to write first.
                </strong>{" "}
                Resender cannot initiate a conversation and cannot reopen a
                closed one. It does not send WhatsApp message templates in this
                phase, and there is no way to make it do so.
              </li>
            </ul>
            <p className="mt-2">
              Every inbound message from a customer opens a{" "}
              <strong className="text-foreground">
                24-hour customer service window
              </strong>
              , and Resender only sends inside it. Once 24 hours pass with no
              new message from that person, sending stops: the API rejects the
              attempt and no call is made to Meta. Imported history, delivery
              receipts and your own outgoing messages do not open or extend the
              window.
            </p>
          </Section>

          <Section title="Media on WhatsApp">
            <p>
              Media that people send to your WhatsApp number is downloaded and
              stored so you can read it later. It is{" "}
              <strong className="text-foreground">
                retained for 180 days from the day it arrives
              </strong>{" "}
              and then deleted automatically. This applies to every plan, is not
              configurable, and the message itself stays in your log after the
              file is gone. If you need a file for longer, download it before it
              expires.
            </p>
            <p className="mt-2">
              <strong className="text-foreground">
                Outgoing media is hosted by you.
              </strong>{" "}
              To send a file you supply a public https URL, and Meta fetches the
              file from your server at the moment of sending. Resender does not
              host, upload or store outbound media. Two consequences are yours
              to manage: if that URL is unreachable when the message is sent,
              the message fails; and Meta keeps its own copy for roughly ten
              minutes, so a link that stops working later may leave the
              recipient unable to open the file.
            </p>
          </Section>

          <Section title="Meta platform rules">
            <p>
              You must comply with Meta&apos;s Platform Terms, the Messenger
              Platform policies, the WhatsApp Business Messaging Policy and
              Commerce Policy, Community Standards, and any other rules that
              apply to your Facebook Page, Instagram account, WhatsApp number or
              conversations. You may not use Resender to bypass Meta policies,
              rate limits, review requirements, messaging windows, or user
              consent requirements. WhatsApp policies apply to what you send
              regardless of whether Resender enforces them technically: if a use
              is incompatible with them, it is not permitted here either.
            </p>
          </Section>

          <Section title="Acceptable use">
            <p>You may not use Resender to:</p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                Send spam, deceptive messages, phishing, or unwanted outreach —
                on WhatsApp this includes messaging anyone who has not opted in,
                and any bulk, promotional or campaign-style use of a connected
                number.
              </li>
              <li>
                Use a channel in a way that is incompatible with the platform
                policies that govern it, including the WhatsApp Business
                Messaging Policy, or attempt to work around the 24-hour window.
              </li>
              <li>
                Harass, threaten, discriminate against, or exploit any person or
                group.
              </li>
              <li>
                Collect, infer, or process sensitive data without a lawful basis
                and clear user notice.
              </li>
              <li>
                Send illegal, harmful, fraudulent, or misleading content or
                media through any connected channel.
              </li>
              <li>Scrape, sell, rent, or misuse conversation data.</li>
              <li>
                Connect webhook destinations that you do not control or that are
                not authorized to receive the relevant messages.
              </li>
            </ul>
          </Section>

          <Section title="External automations">
            <p>
              Resender forwards inbound messages to the webhook URL you
              configure. You are responsible for the security, availability,
              behavior, and legal compliance of that external system. Resender
              may record delivery attempts and errors, but it does not control
              your external automation.
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
              account is violating these terms, Meta policies, applicable law,
              or the security and integrity of Resender. You may delete your
              account from Settings or request deletion by email.
            </p>
          </Section>

          <Section title="Service availability">
            <p>
              Resender is provided as an online service and may be unavailable
              during maintenance, outages, provider incidents, or events outside
              our control. We do not guarantee uninterrupted delivery of
              messages to external automations or third-party platforms.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              We may update these terms from time to time. The &ldquo;Last
              updated&rdquo; date above reflects the latest version.
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
      <SiteFooter lang="es" />
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
