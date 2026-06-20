import { normalizeEmail } from "@/lib/auth/validation"
import type { PageStatus } from "@/lib/pages/page-registry"

// A connected page as seen by the deletion flow: enough to decide whether it
// needs a best-effort Meta webhook unsubscribe before the tenant is wiped.
export type DeletionPage = {
  metaPageId: string
  status: PageStatus
  pageAccessToken: string
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
