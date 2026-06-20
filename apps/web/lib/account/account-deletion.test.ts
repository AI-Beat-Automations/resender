import { describe, expect, it } from "vitest"

import {
  accountDeletionConfirmationMatches,
  planWebhookUnsubscribes,
  type DeletionPage,
} from "./account-deletion"

describe("account deletion confirmation", () => {
  it("matches the account email exactly", () => {
    expect(
      accountDeletionConfirmationMatches("user@example.com", "user@example.com")
    ).toBe(true)
  })

  it("ignores surrounding whitespace and case", () => {
    expect(
      accountDeletionConfirmationMatches("  USER@Example.com ", "user@example.com")
    ).toBe(true)
  })

  it("rejects a different or empty value", () => {
    expect(
      accountDeletionConfirmationMatches("other@example.com", "user@example.com")
    ).toBe(false)
    expect(accountDeletionConfirmationMatches("", "user@example.com")).toBe(false)
    expect(accountDeletionConfirmationMatches(null, "user@example.com")).toBe(false)
  })

  it("never matches when the account email is missing", () => {
    expect(accountDeletionConfirmationMatches("", "")).toBe(false)
  })
})

describe("webhook unsubscribe planning", () => {
  const page = (overrides: Partial<DeletionPage>): DeletionPage => ({
    metaPageId: "100",
    status: "active",
    pageAccessToken: "token",
    ...overrides,
  })

  it("plans an unsubscribe only for active pages with a token", () => {
    const pages = [
      page({ metaPageId: "active", status: "active" }),
      page({ metaPageId: "disconnected", status: "disconnected" }),
      page({ metaPageId: "no-token", status: "active", pageAccessToken: "" }),
    ]

    expect(planWebhookUnsubscribes(pages).map((p) => p.metaPageId)).toEqual([
      "active",
    ])
  })

  it("returns nothing when there are no pages", () => {
    expect(planWebhookUnsubscribes([])).toEqual([])
  })
})
