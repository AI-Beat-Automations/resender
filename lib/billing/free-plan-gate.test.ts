import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  isEmailVerified: vi.fn(),
  hasActiveSubscription: vi.fn(),
}))

vi.mock("@/lib/auth/email-verified", () => ({
  isEmailVerified: mocks.isEmailVerified,
}))
vi.mock("./subscription", () => ({
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

import { needsEmailVerification } from "./free-plan-gate"

describe("needsEmailVerification (ADR 0022)", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
  })

  it("lets a verified account in without reading the subscription", async () => {
    mocks.isEmailVerified.mockResolvedValue(true)

    await expect(needsEmailVerification("user-1")).resolves.toBe(false)
    expect(mocks.hasActiveSubscription).not.toHaveBeenCalled()
  })

  it("asks an unverified free account to confirm its email", async () => {
    mocks.isEmailVerified.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(false)

    await expect(needsEmailVerification("user-1")).resolves.toBe(true)
  })

  it("lets an unverified paying account in", async () => {
    mocks.isEmailVerified.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)

    await expect(needsEmailVerification("user-1")).resolves.toBe(false)
    expect(mocks.hasActiveSubscription).toHaveBeenCalledWith("user-1")
  })
})
