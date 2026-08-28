import { describe, expect, it } from "vitest"

import {
  accountDeletionConfirmationMatches,
  deletedConnectionIds,
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
      accountDeletionConfirmationMatches(
        "  USER@Example.com ",
        "user@example.com"
      )
    ).toBe(true)
  })

  it("rejects a different or empty value", () => {
    expect(
      accountDeletionConfirmationMatches(
        "other@example.com",
        "user@example.com"
      )
    ).toBe(false)
    expect(accountDeletionConfirmationMatches("", "user@example.com")).toBe(
      false
    )
    expect(accountDeletionConfirmationMatches(null, "user@example.com")).toBe(
      false
    )
  })

  it("never matches when the account email is missing", () => {
    expect(accountDeletionConfirmationMatches("", "")).toBe(false)
  })
})

describe("webhook unsubscribe planning", () => {
  const page = (overrides: Partial<DeletionPage>): DeletionPage => ({
    id: "row-1",
    channel: "messenger",
    metaPageId: "100",
    wabaId: null,
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

  it("carries the WABA id so WhatsApp can target the right node", () => {
    // `metaPageId` en WhatsApp es el `phone_number_id`, que no es un nodo con
    // `subscribed_apps`: sin `wabaId` la desuscripción no es posible.
    const [whatsapp] = planWebhookUnsubscribes([
      page({ channel: "whatsapp", metaPageId: "phone-1", wabaId: "waba-1" }),
    ])

    expect(whatsapp?.wabaId).toBe("waba-1")
  })
})

describe("deleted connection ids", () => {
  const page = (overrides: Partial<DeletionPage>): DeletionPage => ({
    id: "row-1",
    channel: "whatsapp",
    metaPageId: "100",
    wabaId: "waba-1",
    status: "active",
    pageAccessToken: "token",
    ...overrides,
  })

  it("excludes every connection of the tenant, not just the ones unsubscribed", () => {
    // El cascade se lleva también las desconectadas y las que no tienen token,
    // así que ninguna puede seguir contando como número activo del WABA.
    const pages = [
      page({ id: "a" }),
      page({ id: "b", status: "disconnected" }),
      page({ id: "c", pageAccessToken: "" }),
    ]

    expect(deletedConnectionIds(pages)).toEqual(["a", "b", "c"])
  })

  it("returns nothing when there are no pages", () => {
    expect(deletedConnectionIds([])).toEqual([])
  })
})
