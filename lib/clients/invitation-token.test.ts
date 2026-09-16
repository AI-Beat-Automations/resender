import { describe, expect, it } from "vitest"

import {
  generateInvitationToken,
  hashInvitationToken,
  INVITATION_TTL_MS,
  invitationExpiresAt,
} from "./invitation-token"

describe("invitation token", () => {
  it("genera tokens distintos, largos y aptos para URL", () => {
    const a = generateInvitationToken()
    const b = generateInvitationToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(40)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("el hash es determinista y no revela el token", () => {
    const token = generateInvitationToken()
    const hash = hashInvitationToken(token)
    expect(hash).toBe(hashInvitationToken(token))
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toContain(token)
  })

  it("vence a los 7 días", () => {
    const now = new Date("2026-09-16T10:00:00Z")
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(invitationExpiresAt(now).toISOString()).toBe(
      "2026-09-23T10:00:00.000Z"
    )
  })
})
