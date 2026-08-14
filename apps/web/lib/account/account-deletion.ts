import { normalizeEmail } from "@/lib/auth/validation"
import type { PageChannel, PageStatus } from "@/lib/pages/page-registry"

// A connected page as seen by the deletion flow: enough to decide whether it
// needs a best-effort Meta webhook unsubscribe before the tenant is wiped.
// `channel` picks which unsubscribe endpoint applies: Messenger, Instagram and
// WhatsApp take different hosts, paths, ids and tokens.
export type DeletionPage = {
  // The `connected_pages` row id. Needed by the WhatsApp unsubscribe rule: the
  // subscription hangs off the WABA, so the dispatcher only unsubscribes when no
  // active number of that WABA is left — and during a tenant deletion every row
  // of this tenant is still `active` in the database, so they have to be named
  // as the ones going away or the count would never reach zero.
  id: string
  channel: PageChannel
  metaPageId: string
  status: PageStatus
  pageAccessToken: string
  // Only WhatsApp has one, and only WhatsApp needs it: its webhook subscription
  // hangs off the WABA, not off the phone number that `metaPageId` holds.
  // Carried through here so tenant deletion can unsubscribe it for real instead
  // of firing a call that was always going to fail.
  wabaId: string | null
}

// True when the value the user typed matches the account email. Emails are
// stored normalized (trimmed + lowercased), so we compare on the same footing.
export function accountDeletionConfirmationMatches(
  typedValue: unknown,
  accountEmail: string
): boolean {
  const account = normalizeEmail(accountEmail)
  if (!account) return false
  return normalizeEmail(typedValue) === account
}

// Given every connected page of a tenant, return the ones that still need a
// best-effort unsubscribe from Meta's webhook: only active pages with a token.
// Disconnected pages were already unsubscribed (or never matter for new traffic).
export function planWebhookUnsubscribes(pages: DeletionPage[]): DeletionPage[] {
  return pages.filter(
    (page) => page.status === "active" && page.pageAccessToken.length > 0
  )
}
