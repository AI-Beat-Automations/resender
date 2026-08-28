import Link from "next/link"
import type { Metadata } from "next"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Resender, operated by Lorna Suriano Hernandez, handles account, Messenger, Instagram and WhatsApp data.",
}

const LAST_UPDATED = "August 24, 2026"
const CONTACT_EMAIL = "info@resender.dev"

export default function PrivacyPage() {
  return (
    <div className="light flex min-h-svh flex-col">
      <SiteBackground />
      <SiteHeader lang="es" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Privacy Policy
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
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;). Resender is the product;
              Lorna Suriano Hernandez is the company responsible for it. Lorna
              Suriano Hernandez operates from Argentina. This policy explains
              what data we handle, how we use it, who we share it with, and how
              to have it deleted.
            </p>
          </Section>

          <Section title="Our role: controller and processor">
            <p>We handle two classes of data with two different roles:</p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                <strong className="text-foreground">Account data</strong> of our
                customers (the businesses that sign up for Resender,
                &ldquo;tenants&rdquo;): Lorna Suriano Hernandez is the data
                controller (responsable).
              </li>
              <li>
                <strong className="text-foreground">
                  Channel end-user data
                </strong>{" "}
                — the messages people send to a customer&rsquo;s connected
                Facebook Page, Instagram account or WhatsApp business number:
                Lorna Suriano Hernandez acts as a processor (encargado) on
                behalf of that customer, who is the controller of those
                conversations.
              </li>
            </ul>
          </Section>

          <Section title="Data we handle">
            <p className="font-medium text-foreground">Account data</p>
            <ul className="mt-1 ml-5 list-disc space-y-1">
              <li>Your email address and a hashed password.</li>
              <li>
                Connected Facebook Pages and Instagram accounts: name and id,
                the access token (stored encrypted), and an optional webhook URL
                you configure.
              </li>
              <li>
                Connected WhatsApp Business Accounts (WABA): the WABA id, the
                business phone number and its id, the display name, how the
                number was onboarded (standard or Coexistence), and the access
                token (stored encrypted).
              </li>
              <li>
                The two-step verification PIN of a connected WhatsApp number,
                when registering the number required us to set one. It is stored
                encrypted, we keep it only so you can re-register or reconnect
                your own number, and we show it back to you on request.
              </li>
              <li>
                API keys you create for external integrations: stored only as a
                hash plus a short visible prefix. The full secret is shown once,
                at creation, and never again.
              </li>
            </ul>
            <p className="mt-4 font-medium text-foreground">
              Channel end-user data
            </p>
            <ul className="mt-1 ml-5 list-disc space-y-1">
              <li>
                On Messenger and Instagram, the contact&rsquo;s scoped id (PSID
                or IGSID) and optional name.
              </li>
              <li>
                On WhatsApp, the customer&rsquo;s phone number, the WhatsApp id
                of that number, and the profile name WhatsApp reports for it.
              </li>
              <li>
                Message content, direction (inbound/outbound) and status, the
                Meta message id, the provider response, and delivery metadata
                for messages we forward to your external system.
              </li>
              <li>
                Media people send you on WhatsApp — images, video, audio and
                voice notes, documents and stickers — together with its type,
                size, filename and download state.
              </li>
            </ul>
            {/* Categoría nueva (ADR 0007): el correo de la lista de espera es
                de alguien que no es cliente y se guarda para escribirle, así
                que no entra ni en Account data ni en Channel end-user data.
                El texto dice lo mismo que el checkbox de consentimiento del
                diccionario, que es lo que se versiona en `consent_version`. */}
            <p className="mt-4 font-medium text-foreground">Waitlist data</p>
            <ul className="mt-1 ml-5 list-disc space-y-1">
              <li>
                The email address you leave on our waitlist, and how you heard
                about Resender (the option you pick, plus the short free-text
                detail if you choose &ldquo;Other&rdquo;).
              </li>
              <li>
                When you accepted the waitlist notice and which version of that
                notice you accepted, plus which page of our site you signed up
                from.
              </li>
              <li>
                We use it for one thing only: to send you product updates. It is
                not linked to any account, it is not used for sales follow-up,
                and it is never sold or shared.
              </li>
              <li>
                To be removed, email {CONTACT_EMAIL} and we will delete your
                waitlist entry.
              </li>
            </ul>
          </Section>

          <Section title="WhatsApp Coexistence">
            <p>
              A business can connect a number that already runs on the WhatsApp
              Business App and keep using both the phone app and Resender at the
              same time. This is called Coexistence, and it is optional: it only
              happens if the business explicitly opts in during the connection
              flow.
            </p>
            <p className="mt-2">
              When it opts in, Resender imports from that WhatsApp Business App:
            </p>
            <ul className="mt-1 ml-5 list-disc space-y-1">
              <li>
                The messaging history of that number, going back{" "}
                <strong className="text-foreground">up to 180 days</strong>.
                That history includes messages from people who wrote to the
                business before Resender existed for them.
              </li>
              <li>
                The contacts of that number, used to show a name next to a
                conversation.
              </li>
              <li>
                Messages the business later sends from the phone app itself, so
                the log stays complete.
              </li>
            </ul>
            <p className="mt-2">
              Imported history is stored as history: it is not forwarded to the
              customer&rsquo;s external automation and it does not trigger
              anything. WhatsApp only makes media files available for the last
              14 days of that history; older messages are imported without their
              file, and we mark them as such.
            </p>
          </Section>

          <Section title="Media files">
            <p>
              Media that people send to a connected WhatsApp number — images,
              video, audio and voice notes, documents and stickers — is
              downloaded from Meta as it arrives and stored in a{" "}
              <strong className="text-foreground">
                private Cloudflare R2 bucket
              </strong>
              . The bucket has no public access: a file can only be read through
              an authenticated Resender request, and only by the account that
              owns the conversation.
            </p>
            <p className="mt-2">
              We download it because Meta&rsquo;s copy is temporary — the
              download link is valid for minutes — so our copy is the only one
              that lasts. Stored media is retained for{" "}
              <strong className="text-foreground">180 days</strong> from the day
              it arrives and is then deleted automatically by a lifecycle rule
              on the bucket. After that the message stays in the log, marked as
              having an expired file. Retention is 180 days for every plan and
              is not configurable.
            </p>
            <p className="mt-2">
              Media the customer sends out is not stored by us at all: the
              customer supplies a public URL, Meta fetches the file from there,
              and Resender never holds a copy.
            </p>
          </Section>

          <Section title="How we use data">
            <p>
              We use account data and channel data only to operate the service:
              to receive and store incoming messages, forward them to the
              customer&rsquo;s configured external system, send outgoing replies
              through Meta, authenticate API access, and keep the message log
              available to the customer. Waitlist data is the one exception: it
              belongs to people who are not customers, and we use it solely to
              send them product updates, as described above. We do not sell data
              and we do not use it for advertising.
            </p>
          </Section>

          <Section title="How we protect it">
            <p>
              Access tokens and the WhatsApp two-step verification PIN are
              encrypted at rest. API key secrets are stored as hashes, never in
              clear text. Authentication uses a single functional session
              cookie. Media files live in a private bucket with no public URL,
              and every download is authorized against the database row that
              owns the file, not against the bucket.
            </p>
          </Section>

          <Section title="Where data is stored and who processes it">
            <p>
              Resender runs on Cloudflare Workers, with a PostgreSQL database on
              Neon and WhatsApp media in Cloudflare R2. Data is stored in the
              United States. Lorna Suriano Hernandez operates from Argentina.
            </p>
            <p className="mt-2">Our sub-processors are:</p>
            <ul className="mt-1 ml-5 list-disc space-y-1">
              <li>
                <strong className="text-foreground">Meta Platforms</strong> —
                message delivery through the Messenger Platform, the Instagram
                Platform and the WhatsApp Business Platform.
              </li>
              <li>
                <strong className="text-foreground">Cloudflare</strong> —
                application hosting (Workers) and private media storage (R2).
              </li>
              <li>
                <strong className="text-foreground">Neon</strong> — managed
                PostgreSQL database.
              </li>
            </ul>
          </Section>

          <Section title="Cookies and tracking">
            <p>
              We use no analytics and no third-party trackers. The only cookie
              is the functional session cookie used to keep you signed in. Fonts
              are self-hosted, so loading the site makes no third-party font
              request.
            </p>
          </Section>

          <Section title="Data retention">
            <p>
              We keep your data while your account is active. Disconnecting a
              Page, an Instagram account or a WhatsApp number stops future
              message traffic but preserves the existing conversation history as
              a log. Deleting your account removes everything (see below).
            </p>
            <p className="mt-2">
              WhatsApp media files are the one thing we delete on a clock of
              their own:{" "}
              <strong className="text-foreground">
                180 days after they arrive, they are deleted automatically
              </strong>
              , whether or not the account is still active.
            </p>
          </Section>

          <Section title="The one identifier that outlives your account">
            <p>
              We would rather state this plainly than bury it. When you delete
              your account, every row about you is deleted from the database in
              that moment — but your media files live in object storage, which
              has to be emptied file by file, and after the database rows are
              gone nothing would remember which files were yours.
            </p>
            <p className="mt-2">
              So, immediately before deleting your account, we write{" "}
              <strong className="text-foreground">
                one internal tenant identifier
              </strong>{" "}
              — a random id, not your email, name or phone number — into a small
              table that has no link to your account and holds nothing else
              about you. It exists for exactly one purpose: to tell the cleanup
              job which media files to erase. The row is deleted as soon as the
              storage provider confirms the files are gone, and it can never
              outlive the 180-day expiry of the files themselves. Everything
              else about your account is already gone by then.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              You can request access to, correction of, or deletion of your
              data, and opt out of further processing. To exercise these rights,
              use the self-serve{" "}
              <strong className="text-foreground">Delete account</strong> option
              in Settings, or email us at{" "}
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
              . In short: log in, go to Settings and choose Delete account for
              an immediate, permanent deletion of your account and all
              associated data; or email {CONTACT_EMAIL} and we will delete it
              within 30 days. Backups are purged within 30 days. Stored WhatsApp
              media is erased by a background job right after the account is
              deleted, and is in any case expired by the 180-day rule.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              We may update this policy. The &ldquo;Last updated&rdquo; date
              above reflects the latest version.
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
