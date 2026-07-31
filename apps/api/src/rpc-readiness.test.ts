import { env, exports as workerExports } from "cloudflare:workers"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ContractError } from "@workspace/contracts"
import type Stripe from "stripe"

import { ApiService } from "./application/service"
import { encryptSecret, hashPassword } from "./infrastructure/crypto/secrets"
import {
  SqlRepository,
  type PageRecord,
  type SubscriptionRecord,
  type UserRecord,
} from "./infrastructure/db/repository"
import { MetaClient } from "./infrastructure/meta/client"
import { stripeTransport } from "./infrastructure/stripe/client"

const ACTOR = {
  userId: "6b402566-9e1d-4739-bb61-81ac615a5469",
}
const OTHER_ACTOR_ID = "c7678192-3b8d-41a6-b308-c64b646177ce"
const API_KEY_ID = "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"
const NOW = "2026-07-29T18:00:00.000Z"
const ORIGINAL_WEB_APP_ORIGINS = Reflect.get(env, "WEB_APP_ORIGINS")

describe("backend RPC readiness", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    if (ORIGINAL_WEB_APP_ORIGINS === undefined) {
      Reflect.deleteProperty(env, "WEB_APP_ORIGINS")
    } else {
      Reflect.set(env, "WEB_APP_ORIGINS", ORIGINAL_WEB_APP_ORIGINS)
    }
  })

  it("rejects malformed actors and sensitive inputs before DB or providers", async () => {
    const getUser = vi.spyOn(SqlRepository.prototype, "getUserById")
    const createKey = vi.spyOn(SqlRepository.prototype, "createApiKey")
    const revokeKey = vi.spyOn(SqlRepository.prototype, "revokeApiKey")
    const connectPages = vi.spyOn(SqlRepository.prototype, "connectPages")
    const metaExchange = vi.spyOn(
      MetaClient.prototype,
      "exchangeAuthorizationCode"
    )
    const createStripe = vi.spyOn(stripeTransport, "create")

    const invalidActor = await captureError(
      workerExports.WebAppApi.listApiKeys({
        userId: "not-a-uuid",
      } as never)
    )
    const invalidLabel = await captureError(
      workerExports.WebAppApi.createApiKey(ACTOR, { label: " " })
    )
    const invalidKeyId = await captureError(
      workerExports.WebAppApi.revokeApiKey(ACTOR, {
        apiKeyId: "not-a-uuid",
      })
    )
    const invalidCheckout = await captureError(
      workerExports.WebAppApi.createCheckoutSession(ACTOR, {
        priceLookupKey: "",
        origin: "not-a-url",
      })
    )
    const missingCheckoutOrigin = await captureError(
      workerExports.WebAppApi.createCheckoutSession(ACTOR, {
        priceLookupKey: "starter_monthly",
      } as never)
    )
    const missingPortalOrigin = await captureError(
      workerExports.WebAppApi.createBillingPortalSession(ACTOR, {} as never)
    )
    const invalidSession = await captureError(
      workerExports.WebAppApi.verifyCheckoutSession(ACTOR, {
        sessionId: "cs_foreign",
      })
    )
    const emptyPages = await captureError(
      workerExports.WebAppApi.connectMetaPages(ACTOR, {
        providerPageIds: [],
      })
    )
    const duplicatePages = await captureError(
      workerExports.WebAppApi.connectMetaPages(ACTOR, {
        providerPageIds: ["page_1", "page_1"],
      })
    )
    const tooManyPages = await captureError(
      workerExports.WebAppApi.connectMetaPages(ACTOR, {
        providerPageIds: Array.from(
          { length: 101 },
          (_, index) => `page_${index}`
        ),
      })
    )
    const invalidMeta = await captureError(
      workerExports.WebAppApi.exchangeMetaAuthorizationCode(ACTOR, {
        code: "",
        redirectUri: "not-a-url",
      })
    )

    for (const error of [
      invalidActor,
      invalidLabel,
      invalidKeyId,
      invalidCheckout,
      missingCheckoutOrigin,
      missingPortalOrigin,
      invalidSession,
      emptyPages,
      duplicatePages,
      tooManyPages,
      invalidMeta,
    ]) {
      expect(error).toMatchObject({ code: "validation_error", status: 400 })
    }
    expect(emptyPages).toMatchObject({
      details: [
        {
          path: "providerPageIds",
          message: "Select at least one Page.",
        },
      ],
    })
    expect(getUser).not.toHaveBeenCalled()
    expect(createKey).not.toHaveBeenCalled()
    expect(revokeKey).not.toHaveBeenCalled()
    expect(connectPages).not.toHaveBeenCalled()
    expect(metaExchange).not.toHaveBeenCalled()
    expect(createStripe).not.toHaveBeenCalled()
  })

  describe("API keys", () => {
    it("applies the product gate before listing keys", async () => {
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser({ waitlisted: true })
      )
      const listApiKeys = vi.spyOn(SqlRepository.prototype, "listApiKeys")

      const error = await captureError(
        workerExports.WebAppApi.listApiKeys(ACTOR)
      )

      expect(error).toMatchObject({
        code: "account_waitlisted",
        status: 403,
      })
      expect(listApiKeys).not.toHaveBeenCalled()
    })

    it("returns revoked history without hashes and reveals a new secret only on create", async () => {
      mockProductActor()
      const internalRecord = {
        id: API_KEY_ID,
        label: "Production",
        visiblePrefix: "pk_live_abcd1234",
        status: "revoked" as const,
        createdAt: NOW,
        lastUsedAt: NOW,
        revokedAt: NOW,
        secretHash: "hash-must-not-cross",
        pepper: "pepper-must-not-cross",
      }
      vi.spyOn(SqlRepository.prototype, "listApiKeys").mockResolvedValue([
        internalRecord,
      ])
      const createApiKey = vi
        .spyOn(SqlRepository.prototype, "createApiKey")
        .mockResolvedValue({
          ...internalRecord,
          status: "active",
          revokedAt: null,
        })

      const listed = await workerExports.WebAppApi.listApiKeys(ACTOR)
      const created = await workerExports.WebAppApi.createApiKey(ACTOR, {
        label: " Production ",
      })

      expect(listed).toEqual([
        {
          id: API_KEY_ID,
          label: "Production",
          visiblePrefix: "pk_live_abcd1234",
          status: "revoked",
          createdAt: NOW,
          lastUsedAt: NOW,
          revokedAt: NOW,
        },
      ])
      expect(created.apiKey).toMatch(/^pk_live_/u)
      expect(created.record).not.toHaveProperty("secretHash")
      expect(created.record).not.toHaveProperty("pepper")
      expect(JSON.stringify({ listed, created })).not.toContain(
        String(env.API_KEY_PEPPER)
      )
      const persisted = createApiKey.mock.calls[0]?.[0]
      expect(persisted).toMatchObject({
        tenantId: ACTOR.userId,
        label: "Production",
        visiblePrefix: expect.stringMatching(/^pk_live_/u),
        secretHash: expect.any(String),
      })
      expect(persisted?.secretHash).not.toBe(created.apiKey)
    })

    it("uses actor ownership for revoke and returns 404 for a foreign key", async () => {
      mockProductActor()
      const revokeApiKey = vi
        .spyOn(SqlRepository.prototype, "revokeApiKey")
        .mockResolvedValue(null)

      const error = await captureError(
        workerExports.WebAppApi.revokeApiKey(ACTOR, {
          apiKeyId: API_KEY_ID,
        })
      )

      expect(error).toMatchObject({ code: "not_found", status: 404 })
      expect(revokeApiKey).toHaveBeenCalledWith(ACTOR.userId, API_KEY_ID)
    })

    it("returns the exact revoked metadata while keeping the secret and hash absent", async () => {
      mockProductActor()
      const revokedAt = "2026-07-30T12:00:00.000Z"
      vi.spyOn(SqlRepository.prototype, "revokeApiKey").mockResolvedValue({
        id: API_KEY_ID,
        label: "Production",
        visiblePrefix: "pk_live_abcd1234",
        status: "revoked",
        createdAt: NOW,
        lastUsedAt: null,
        revokedAt,
      })

      const result = await workerExports.WebAppApi.revokeApiKey(ACTOR, {
        apiKeyId: API_KEY_ID,
      })

      expect(result).toEqual({
        id: API_KEY_ID,
        label: "Production",
        visiblePrefix: "pk_live_abcd1234",
        status: "revoked",
        createdAt: NOW,
        lastUsedAt: null,
        revokedAt,
      })
      expect(JSON.stringify(result)).not.toMatch(
        /secretHash|pepper|tenantId|pk_live_[A-Za-z0-9_-]{20}/u
      )
    })
  })

  describe("credentials and account settings", () => {
    it("authenticates valid credentials without returning hashes and types backend failures", async () => {
      const passwordHash = await hashPassword("correct-password")
      vi.spyOn(SqlRepository.prototype, "getUserByEmail")
        .mockResolvedValueOnce(runtimeUser({ passwordHash }))
        .mockRejectedValueOnce(new Error("database host leaked"))

      const authenticated =
        await workerExports.WebAppApi.authenticateCredentials({
          email: " PERSON@EXAMPLE.COM ",
          password: "correct-password",
        })
      const backendError = await captureError(
        workerExports.WebAppApi.authenticateCredentials({
          email: "person@example.com",
          password: "correct-password",
        })
      )

      expect(authenticated).toEqual({
        id: ACTOR.userId,
        email: "person@example.com",
        waitlisted: false,
        createdAt: "2026-07-01T00:00:00.000Z",
      })
      expect(authenticated).not.toHaveProperty("passwordHash")
      expect(backendError).toMatchObject({
        code: "internal_error",
        status: 500,
        message: "An unexpected error occurred.",
      })
      expect(JSON.stringify(backendError)).not.toContain("database host")
    })

    it("makes malformed, unknown, wrong-password and deleted-user authentication indistinguishable", async () => {
      const getUserByEmail = vi
        .spyOn(SqlRepository.prototype, "getUserByEmail")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(runtimeUser({ passwordHash: "not-a-hash" }))
        .mockResolvedValueOnce(null)

      const results = await Promise.all([
        workerExports.WebAppApi.authenticateCredentials({
          email: "not-an-email",
          password: "incorrect",
        }),
        workerExports.WebAppApi.authenticateCredentials({
          email: "unknown@example.com",
          password: "incorrect",
        }),
        workerExports.WebAppApi.authenticateCredentials({
          email: "person@example.com",
          password: "incorrect",
        }),
        workerExports.WebAppApi.authenticateCredentials({
          email: "deleted@example.com",
          password: "incorrect",
        }),
      ])

      expect(results).toEqual([null, null, null, null])
      expect(getUserByEmail).toHaveBeenCalledTimes(3)
    })

    it("runs equivalent password verification for unknown and wrong-password users", async () => {
      const verify = vi.fn<
        (password: string, storedHash: string) => Promise<boolean>
      >(async () => false)
      const getUserByEmail = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(runtimeUser({ passwordHash: "stored-hash" }))
      const service = new ApiService(env, {
        repository: {
          getUserByEmail,
        } as unknown as SqlRepository,
        verifyPassword: verify,
      })

      await expect(
        service.authenticateCredentials({
          email: "unknown@example.com",
          password: "candidate",
        })
      ).resolves.toBeNull()
      await expect(
        service.authenticateCredentials({
          email: "person@example.com",
          password: "candidate",
        })
      ).resolves.toBeNull()

      expect(verify).toHaveBeenCalledTimes(2)
      expect(verify.mock.calls[0]?.[0]).toBe("candidate")
      expect(verify.mock.calls[0]?.[1]).toMatch(/^scrypt\$/u)
      expect(verify.mock.calls[1]).toEqual(["candidate", "stored-hash"])
    })

    it("keeps duplicate registration explicit and sanitizes backend failures", async () => {
      const duplicate = Object.assign(new Error("duplicate details"), {
        code: "23505",
      })
      vi.spyOn(SqlRepository.prototype, "createUser")
        .mockRejectedValueOnce(duplicate)
        .mockRejectedValueOnce(new Error("database host leaked"))

      const duplicateError = await captureError(
        workerExports.WebAppApi.registerUser({
          email: "person@example.com",
          password: "long-enough",
        })
      )
      const backendError = await captureError(
        workerExports.WebAppApi.registerUser({
          email: "other@example.com",
          password: "long-enough",
        })
      )

      expect(duplicateError).toMatchObject({
        code: "validation_error",
        status: 409,
        message: "An account already exists for this email.",
      })
      expect(backendError).toMatchObject({
        code: "internal_error",
        status: 500,
        message: "An unexpected error occurred.",
      })
      expect(JSON.stringify(backendError)).not.toContain("database host")
    })

    it("registers a normalized user without returning the password hash", async () => {
      const createUser = vi
        .spyOn(SqlRepository.prototype, "createUser")
        .mockImplementation(async (input) =>
          runtimeUser({
            email: input.email,
            passwordHash: input.passwordHash,
          })
        )

      const registered = await workerExports.WebAppApi.registerUser({
        email: " PERSON@EXAMPLE.COM ",
        password: "long-enough",
      })

      expect(registered).toEqual({
        id: ACTOR.userId,
        email: "person@example.com",
        waitlisted: false,
        createdAt: "2026-07-01T00:00:00.000Z",
      })
      expect(registered).not.toHaveProperty("passwordHash")
      expect(createUser.mock.calls[0]?.[0].passwordHash).not.toBe("long-enough")
    })

    it("enforces password policy but does not require an active product", async () => {
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser({ waitlisted: true })
      )
      const changePassword = vi
        .spyOn(SqlRepository.prototype, "changePassword")
        .mockResolvedValue(true)

      const policyError = await captureError(
        workerExports.WebAppApi.changePassword(ACTOR, {
          newPassword: "short",
        })
      )
      await expect(
        workerExports.WebAppApi.changePassword(ACTOR, {
          newPassword: "long-enough",
        })
      ).resolves.toBeUndefined()

      expect(policyError).toMatchObject({
        code: "validation_error",
        status: 400,
      })
      expect(changePassword).toHaveBeenCalledOnce()
      expect(changePassword.mock.calls[0]?.[0]).toBe(ACTOR.userId)
      expect(changePassword.mock.calls[0]?.[1]).not.toBe("long-enough")
    })

    it("reports a failed local delete after best-effort Meta and Stripe compensation", async () => {
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser()
      )
      vi.spyOn(
        SqlRepository.prototype,
        "loadDeletionContext"
      ).mockResolvedValue({
        email: "person@example.com",
        stripeSubscriptionId: "sub_internal",
        pages: [
          {
            providerPageId: "page_internal",
            status: "active",
            encryptedPageToken: encryptSecret(
              String(env.TOKEN_ENCRYPTION_KEY),
              "page-token-must-not-cross"
            ),
          },
          {
            providerPageId: "page_with_corrupt_ciphertext",
            status: "active",
            encryptedPageToken: "corrupt-ciphertext",
          },
        ],
      })
      const unsubscribePage = vi
        .spyOn(MetaClient.prototype, "unsubscribePage")
        .mockRejectedValue(new Error("Meta unavailable"))
      mockStripe({
        subscriptions: {
          cancel: vi.fn().mockRejectedValue(new Error("Stripe unavailable")),
        },
      })
      const deleteTenant = vi
        .spyOn(SqlRepository.prototype, "deleteTenant")
        .mockResolvedValue(false)

      const result = await workerExports.WebAppApi.deleteAccount(ACTOR, {
        confirmEmail: " PERSON@EXAMPLE.COM ",
      })

      expect(result).toEqual({
        deleted: false,
        metaUnsubscribeFailures: 2,
        stripeCancellationFailed: true,
      })
      expect(unsubscribePage).toHaveBeenCalledOnce()
      expect(deleteTenant).toHaveBeenCalledWith(ACTOR.userId)
      expect(JSON.stringify(result)).not.toContain("sub_internal")
      expect(JSON.stringify(result)).not.toContain("page-token")
    })

    it("returns typed 404s for a deleted actor", async () => {
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(null)

      const passwordError = await captureError(
        workerExports.WebAppApi.changePassword(ACTOR, {
          newPassword: "long-enough",
        })
      )
      const deletionError = await captureError(
        workerExports.WebAppApi.deleteAccount(ACTOR, {
          confirmEmail: "person@example.com",
        })
      )

      expect(passwordError).toMatchObject({ code: "not_found", status: 404 })
      expect(deletionError).toMatchObject({ code: "not_found", status: 404 })
    })
  })

  describe("billing", () => {
    it("applies the waitlist actor gate before Checkout provider access", async () => {
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser({ waitlisted: true })
      )
      const createStripe = vi.spyOn(stripeTransport, "create")

      const error = await captureError(
        workerExports.WebAppApi.createCheckoutSession(ACTOR, {
          priceLookupKey: "starter_monthly",
          origin: "https://app.resender.dev",
        })
      )

      expect(error).toMatchObject({
        code: "account_waitlisted",
        status: 403,
      })
      expect(createStripe).not.toHaveBeenCalled()
    })

    it("returns billing state without Stripe customer identifiers or secrets", async () => {
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser()
      )
      vi.spyOn(SqlRepository.prototype, "getSubscription").mockResolvedValue(
        activeSubscription()
      )
      vi.spyOn(SqlRepository.prototype, "countActivePages").mockResolvedValue(1)
      vi.spyOn(SqlRepository.prototype, "getUsage").mockResolvedValue(12)

      const result = await workerExports.WebAppApi.getBillingState(ACTOR)

      expect(result).toMatchObject({
        subscription: {
          status: "active",
          priceLookupKey: "starter_monthly",
        },
        entitlement: {
          usage: 12,
          activePageCount: 1,
        },
      })
      expect(result).not.toHaveProperty("stripeCustomerId")
      expect(JSON.stringify(result)).not.toContain("cus_")
      expect(JSON.stringify(result)).not.toContain("STRIPE_SECRET_KEY")
    })

    it("rejects non-allowlisted prices before Stripe access", async () => {
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser()
      )
      const createStripe = vi.spyOn(stripeTransport, "create")

      const error = await captureError(
        workerExports.WebAppApi.createCheckoutSession(ACTOR, {
          priceLookupKey: "attacker_price",
          origin: "https://app.resender.dev",
        })
      )

      expect(error).toMatchObject({
        code: "plan_unavailable",
        status: 403,
      })
      expect(createStripe).not.toHaveBeenCalled()
    })

    it("normalizes the legacy returnUrl alias before creating Checkout", async () => {
      setAllowedOrigins()
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser()
      )
      vi.spyOn(SqlRepository.prototype, "getSubscription").mockResolvedValue(
        null
      )
      vi.spyOn(
        SqlRepository.prototype,
        "getStripeCustomerId"
      ).mockResolvedValue("cus_internal")
      const createCheckout = vi.fn(async () => ({
        url: "https://checkout.stripe.com/c/pay/legacy-session",
      }))
      mockStripe({
        prices: {
          list: vi.fn(async () => ({ data: [{ id: "price_internal" }] })),
        },
        checkout: { sessions: { create: createCheckout } },
      })

      const result = await workerExports.WebAppApi.createCheckoutSession(
        ACTOR,
        {
          priceLookupKey: "starter_monthly",
          returnUrl: "https://app.resender.dev",
        } as never
      )

      expect(result).toEqual({
        url: "https://checkout.stripe.com/c/pay/legacy-session",
      })
      expect(createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          success_url:
            "https://app.resender.dev/billing/success?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: "https://app.resender.dev/billing",
        })
      )
    })

    it.each([
      ["foreign origin", "https://attacker.example"],
      ["non-root path", "https://app.resender.dev/redirect"],
      ["non-web protocol", "javascript:alert(1)"],
    ])(
      "rejects legacy returnUrl with %s before Stripe access",
      async (_name, returnUrl) => {
        setAllowedOrigins()
        vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
          runtimeUser()
        )
        const getSubscription = vi.spyOn(
          SqlRepository.prototype,
          "getSubscription"
        )
        const createStripe = vi.spyOn(stripeTransport, "create")

        const error = await captureError(
          workerExports.WebAppApi.createCheckoutSession(ACTOR, {
            priceLookupKey: "starter_monthly",
            returnUrl,
          } as never)
        )

        expect(error).toMatchObject({
          code: "validation_error",
          status: 400,
          details: [{ path: "origin" }],
        })
        expect(getSubscription).not.toHaveBeenCalled()
        expect(createStripe).not.toHaveBeenCalled()
        expect(JSON.stringify(error)).not.toMatch(/attacker|javascript/u)
      }
    )

    it("builds Checkout and Portal paths on the exact allowed origin", async () => {
      setAllowedOrigins()
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser()
      )
      vi.spyOn(SqlRepository.prototype, "getSubscription")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(activeSubscription())
      vi.spyOn(
        SqlRepository.prototype,
        "getStripeCustomerId"
      ).mockResolvedValue("cus_internal")
      const createCheckout = vi.fn<
        (input: Record<string, unknown>) => Promise<{ url: string }>
      >(async () => ({
        url: "https://checkout.stripe.com/c/pay/session",
      }))
      const createPortal = vi.fn(async () => ({
        url: "https://billing.stripe.com/p/session/portal",
      }))
      mockStripe({
        prices: {
          list: vi.fn(async () => ({ data: [{ id: "price_internal" }] })),
        },
        checkout: { sessions: { create: createCheckout } },
        billingPortal: { sessions: { create: createPortal } },
      })

      const checkout = await workerExports.WebAppApi.createCheckoutSession(
        ACTOR,
        {
          priceLookupKey: "starter_monthly",
          origin: "https://app.resender.dev",
        }
      )
      const portal = await workerExports.WebAppApi.createBillingPortalSession(
        ACTOR,
        {
          origin: "https://app.resender.dev",
        }
      )

      expect(checkout).toEqual({
        url: "https://checkout.stripe.com/c/pay/session",
      })
      expect(portal).toEqual({
        url: "https://billing.stripe.com/p/session/portal",
      })
      expect(createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          integration_identifier: expect.stringMatching(/^resender_[a-z]{8}$/u),
          customer: "cus_internal",
          subscription_data: {
            metadata: { tenantId: ACTOR.userId },
          },
          success_url:
            "https://app.resender.dev/billing/success?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: "https://app.resender.dev/billing",
        })
      )
      expect(createCheckout.mock.calls[0]?.[0]).not.toHaveProperty(
        "payment_method_types"
      )
      expect(createCheckout.mock.calls[0]?.[0]).not.toHaveProperty(
        "trial_period_days"
      )
      expect(
        (
          createCheckout.mock.calls[0]?.[0] as {
            subscription_data?: Record<string, unknown>
          }
        ).subscription_data
      ).not.toHaveProperty("trial_period_days")
      expect(createPortal).toHaveBeenCalledWith({
        customer: "cus_internal",
        return_url: "https://app.resender.dev/settings",
      })
      expect(JSON.stringify({ checkout, portal })).not.toContain("cus_internal")
    })

    it.each([
      [
        "waitlisted",
        runtimeUser({ waitlisted: true }),
        null,
        "account_waitlisted",
      ],
      ["unsubscribed", runtimeUser(), null, "subscription_required"],
    ] as const)(
      "blocks %s actors from Portal even when a customer could be stored",
      async (_name, actorUser, subscription, code) => {
        vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
          actorUser
        )
        vi.spyOn(SqlRepository.prototype, "getSubscription").mockResolvedValue(
          subscription
        )
        const customer = vi
          .spyOn(SqlRepository.prototype, "getStripeCustomerId")
          .mockResolvedValue("cus_stored")
        const createStripe = vi.spyOn(stripeTransport, "create")

        const error = await captureError(
          workerExports.WebAppApi.createBillingPortalSession(ACTOR, {
            origin: "https://app.resender.dev",
          })
        )

        expect(error).toMatchObject({ code, status: 403 })
        expect(customer).not.toHaveBeenCalled()
        expect(createStripe).not.toHaveBeenCalled()
      }
    )

    it("returns a safe not-found when an active tenant has no Portal customer", async () => {
      setAllowedOrigins()
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser()
      )
      vi.spyOn(SqlRepository.prototype, "getSubscription").mockResolvedValue(
        activeSubscription()
      )
      vi.spyOn(
        SqlRepository.prototype,
        "getStripeCustomerId"
      ).mockResolvedValue(null)
      const createStripe = vi.spyOn(stripeTransport, "create")

      const error = await captureError(
        workerExports.WebAppApi.createBillingPortalSession(ACTOR, {
          origin: "https://app.resender.dev",
        })
      )

      expect(error).toMatchObject({ code: "not_found", status: 404 })
      expect(JSON.stringify(error)).not.toMatch(/customer|cus_/u)
      expect(createStripe).not.toHaveBeenCalled()
    })

    it("enforces Checkout-session ownership during verification", async () => {
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser()
      )
      mockStripe({
        checkout: {
          sessions: {
            retrieve: vi.fn(async () => ({
              status: "complete",
              metadata: { tenantId: OTHER_ACTOR_ID },
              customer: "cus_must_not_cross",
            })),
          },
        },
      })

      const error = await captureError(
        workerExports.WebAppApi.verifyCheckoutSession(ACTOR, {
          sessionId: "cs_test_1234567890abcdef",
        })
      )

      expect(error).toMatchObject({ code: "not_found", status: 404 })
      expect(JSON.stringify(error)).not.toContain("cus_must_not_cross")
    })

    it.each([
      ["complete", "complete", true],
      ["open", "open", false],
    ] as const)(
      "returns only verified=%s for an owned %s Checkout",
      async (_name, status, complete) => {
        vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
          runtimeUser()
        )
        mockStripe({
          checkout: {
            sessions: {
              retrieve: vi.fn(async () => ({
                status,
                metadata: { tenantId: ACTOR.userId },
                customer: "cus_must_not_cross",
                subscription: "sub_must_not_cross",
              })),
            },
          },
        })

        const result = await workerExports.WebAppApi.verifyCheckoutSession(
          ACTOR,
          { sessionId: "cs_live_1234567890abcdef" }
        )

        expect(result).toEqual({ complete })
        expect(JSON.stringify(result)).not.toMatch(/cus_|sub_|customer/u)
      }
    )

    it("rejects non-Stripe redirect URLs without returning provider data", async () => {
      setAllowedOrigins()
      vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
        runtimeUser()
      )
      vi.spyOn(SqlRepository.prototype, "getSubscription").mockResolvedValue(
        null
      )
      vi.spyOn(
        SqlRepository.prototype,
        "getStripeCustomerId"
      ).mockResolvedValue("cus_internal")
      mockStripe({
        prices: {
          list: vi.fn(async () => ({ data: [{ id: "price_internal" }] })),
        },
        checkout: {
          sessions: {
            create: vi.fn(async () => ({
              url: "https://attacker.example/steal?session=secret",
            })),
          },
        },
      })

      const error = await captureError(
        workerExports.WebAppApi.createCheckoutSession(ACTOR, {
          priceLookupKey: "starter_monthly",
          origin: "https://app.resender.dev",
        })
      )

      expect(error).toMatchObject({
        code: "provider_unavailable",
        status: 502,
      })
      expect(JSON.stringify(error)).not.toMatch(/attacker|session=secret/u)
    })
  })

  describe("Meta OAuth and Pages", () => {
    it("accepts only the exact callback and persists token ciphertext without returning it", async () => {
      setAllowedOrigins()
      mockProductActor()
      const exchange = vi
        .spyOn(MetaClient.prototype, "exchangeAuthorizationCode")
        .mockResolvedValue("meta-token-must-not-cross")
      const saveToken = vi
        .spyOn(SqlRepository.prototype, "saveMetaUserToken")
        .mockResolvedValue()

      const invalid = await captureError(
        workerExports.WebAppApi.exchangeMetaAuthorizationCode(ACTOR, {
          code: "authorization-code",
          redirectUri: "https://app.resender.dev/connections",
        })
      )
      const evilOrigin = await captureError(
        workerExports.WebAppApi.exchangeMetaAuthorizationCode(ACTOR, {
          code: "authorization-code",
          redirectUri: "https://evil.example/api/meta/callback",
        })
      )
      const result =
        await workerExports.WebAppApi.exchangeMetaAuthorizationCode(ACTOR, {
          code: "authorization-code",
          redirectUri: "https://app.resender.dev/api/meta/callback",
        })

      expect(invalid).toMatchObject({
        code: "validation_error",
        status: 400,
        details: [{ path: "redirectUri" }],
      })
      expect(evilOrigin).toMatchObject({
        code: "validation_error",
        status: 400,
        details: [{ path: "redirectUri" }],
      })
      expect(exchange).toHaveBeenCalledOnce()
      expect(exchange).toHaveBeenCalledWith({
        code: "authorization-code",
        redirectUri: "https://app.resender.dev/api/meta/callback",
      })
      expect(result).toEqual({ authorized: true })
      expect(JSON.stringify(result)).not.toContain("authorization-code")
      expect(JSON.stringify(result)).not.toContain("meta-token")
      const ciphertext = saveToken.mock.calls[0]?.[1]
      expect(ciphertext).not.toBe("meta-token-must-not-cross")
      expect(ciphertext).not.toContain("meta-token-must-not-cross")
    })

    it("returns only minimal selectable Page data and treats disconnected foreign ownership as unavailable", async () => {
      mockProductActor()
      vi.spyOn(SqlRepository.prototype, "countActivePages").mockResolvedValue(0)
      vi.spyOn(SqlRepository.prototype, "getUsage").mockResolvedValue(0)
      vi.spyOn(
        SqlRepository.prototype,
        "getMetaUserTokenEncrypted"
      ).mockResolvedValue(
        encryptSecret(String(env.TOKEN_ENCRYPTION_KEY), "user-token")
      )
      vi.spyOn(MetaClient.prototype, "listPages").mockResolvedValue([
        { id: "page_free", name: "Free", accessToken: "page-token-free" },
        {
          id: "page_foreign",
          name: "Foreign",
          accessToken: "page-token-foreign",
        },
      ])
      vi.spyOn(SqlRepository.prototype, "getPageOwnership").mockResolvedValue([
        {
          providerPageId: "page_foreign",
          tenantId: OTHER_ACTOR_ID,
          status: "disconnected",
        },
      ])

      const result =
        await workerExports.WebAppApi.listAuthorizedMetaPages(ACTOR)

      expect(result).toEqual({
        pages: [
          { providerPageId: "page_free", name: "Free", state: "selectable" },
          {
            providerPageId: "page_foreign",
            name: "Foreign",
            state: "owned_by_other_tenant",
          },
        ],
        maxPages: 2,
        activePageCount: 0,
        remainingSlots: 2,
      })
      expect(JSON.stringify(result)).not.toMatch(/token|cipher/iu)
    })

    it("rejects foreign Page ownership and plan overflow before provider writes", async () => {
      mockProductActor()
      vi.spyOn(SqlRepository.prototype, "countActivePages")
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2)
      vi.spyOn(SqlRepository.prototype, "getUsage").mockResolvedValue(0)
      vi.spyOn(SqlRepository.prototype, "getPageOwnership")
        .mockResolvedValueOnce([
          {
            providerPageId: "page_foreign",
            tenantId: OTHER_ACTOR_ID,
            status: "disconnected",
          },
        ])
        .mockResolvedValueOnce([])
      const listPages = vi.spyOn(MetaClient.prototype, "listPages")
      const connectPages = vi.spyOn(SqlRepository.prototype, "connectPages")

      const ownershipError = await captureError(
        workerExports.WebAppApi.connectMetaPages(ACTOR, {
          providerPageIds: ["page_foreign"],
        })
      )
      const limitError = await captureError(
        workerExports.WebAppApi.connectMetaPages(ACTOR, {
          providerPageIds: ["page_new"],
        })
      )

      expect(ownershipError).toMatchObject({
        code: "provider_rejected",
        status: 422,
      })
      expect(limitError).toMatchObject({
        code: "page_limit_exceeded",
        status: 403,
      })
      expect(listPages).not.toHaveBeenCalled()
      expect(connectPages).not.toHaveBeenCalled()
    })

    it("does not unsubscribe an app-wide Meta subscription after persistence loses a race", async () => {
      mockProductActor()
      vi.spyOn(SqlRepository.prototype, "countActivePages").mockResolvedValue(0)
      vi.spyOn(SqlRepository.prototype, "getUsage").mockResolvedValue(0)
      vi.spyOn(SqlRepository.prototype, "getPageOwnership").mockResolvedValue(
        []
      )
      vi.spyOn(
        SqlRepository.prototype,
        "getMetaUserTokenEncrypted"
      ).mockResolvedValue(
        encryptSecret(
          String(env.TOKEN_ENCRYPTION_KEY),
          "user-token-must-not-cross"
        )
      )
      vi.spyOn(MetaClient.prototype, "listPages").mockResolvedValue([
        { id: "page_1", name: "One", accessToken: "page-token-1" },
        { id: "page_2", name: "Two", accessToken: "page-token-2" },
      ])
      const subscribePage = vi
        .spyOn(MetaClient.prototype, "subscribePage")
        .mockResolvedValue()
      const unsubscribePage = vi
        .spyOn(MetaClient.prototype, "unsubscribePage")
        .mockResolvedValue()
      const connectPages = vi
        .spyOn(SqlRepository.prototype, "connectPages")
        .mockRejectedValue(new Error("transaction failed"))

      const error = await captureError(
        workerExports.WebAppApi.connectMetaPages(ACTOR, {
          providerPageIds: ["page_1", "page_2"],
        })
      )

      expect(error).toMatchObject({
        code: "internal_error",
        status: 500,
        message: "An unexpected error occurred.",
      })
      expect(subscribePage.mock.calls).toEqual([
        ["page_1", "page-token-1"],
        ["page_2", "page-token-2"],
      ])
      expect(connectPages).toHaveBeenCalledOnce()
      expect(connectPages.mock.calls[0]?.[1]).toHaveLength(2)
      expect(connectPages.mock.calls[0]?.[2]).toBe(2)
      for (const page of connectPages.mock.calls[0]?.[1] ?? []) {
        expect(page.encryptedPageToken).not.toContain("page-token")
      }
      expect(unsubscribePage).not.toHaveBeenCalled()
      expect(JSON.stringify(error)).not.toContain("page-token")
      expect(JSON.stringify(error)).not.toContain("user-token")
    })

    it("atomically admits only one concurrent connection for the final plan slot", async () => {
      mockProductActor()
      vi.spyOn(SqlRepository.prototype, "countActivePages").mockResolvedValue(1)
      vi.spyOn(SqlRepository.prototype, "getUsage").mockResolvedValue(0)
      vi.spyOn(SqlRepository.prototype, "getPageOwnership").mockResolvedValue(
        []
      )
      vi.spyOn(
        SqlRepository.prototype,
        "getMetaUserTokenEncrypted"
      ).mockResolvedValue(
        encryptSecret(String(env.TOKEN_ENCRYPTION_KEY), "user-token")
      )
      vi.spyOn(MetaClient.prototype, "listPages").mockResolvedValue([
        { id: "page_1", name: "One", accessToken: "page-token-1" },
        { id: "page_2", name: "Two", accessToken: "page-token-2" },
      ])
      vi.spyOn(MetaClient.prototype, "subscribePage").mockResolvedValue()

      let entered = 0
      let release!: () => void
      const bothEntered = new Promise<void>((resolve) => {
        release = resolve
      })
      let activePages = 1
      vi.spyOn(SqlRepository.prototype, "connectPages").mockImplementation(
        async (tenantId, pages, maxPages) => {
          entered += 1
          if (entered === 2) release()
          await bothEntered
          if (activePages + pages.length > maxPages) {
            return { kind: "page_limit_exceeded", pages: [] }
          }
          activePages += pages.length
          return {
            kind: "connected",
            pages: pages.map((page) =>
              runtimePage({
                tenantId,
                providerPageId: page.providerPageId,
                name: page.name,
                pageAccessTokenEncrypted: page.encryptedPageToken,
              })
            ),
          }
        }
      )

      const results = await Promise.allSettled([
        workerExports.WebAppApi.connectMetaPages(ACTOR, {
          providerPageIds: ["page_1"],
        }),
        workerExports.WebAppApi.connectMetaPages(ACTOR, {
          providerPageIds: ["page_2"],
        }),
      ])

      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1)
      const rejected = results.find((result) => result.status === "rejected")
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { code: "page_limit_exceeded", status: 403 },
      })
      expect(activePages).toBe(2)
    })

    it("returns neutral not_found and never unsubscribes when ownership changes after precheck", async () => {
      mockProductActor()
      vi.spyOn(SqlRepository.prototype, "countActivePages").mockResolvedValue(0)
      vi.spyOn(SqlRepository.prototype, "getUsage").mockResolvedValue(0)
      vi.spyOn(SqlRepository.prototype, "getPageOwnership").mockResolvedValue(
        []
      )
      vi.spyOn(
        SqlRepository.prototype,
        "getMetaUserTokenEncrypted"
      ).mockResolvedValue(
        encryptSecret(String(env.TOKEN_ENCRYPTION_KEY), "user-token")
      )
      vi.spyOn(MetaClient.prototype, "listPages").mockResolvedValue([
        { id: "page_race", name: "Race", accessToken: "page-token" },
      ])
      vi.spyOn(MetaClient.prototype, "subscribePage").mockResolvedValue()
      const unsubscribe = vi.spyOn(MetaClient.prototype, "unsubscribePage")
      vi.spyOn(SqlRepository.prototype, "connectPages").mockResolvedValue({
        kind: "ownership_conflict",
        pages: [],
      })

      const error = await captureError(
        workerExports.WebAppApi.connectMetaPages(ACTOR, {
          providerPageIds: ["page_race"],
        })
      )

      expect(error).toMatchObject({ code: "not_found", status: 404 })
      expect(JSON.stringify(error)).not.toContain("page_race")
      expect(unsubscribe).not.toHaveBeenCalled()
    })

    it("preserves typed provider errors without leaking tokens", async () => {
      setAllowedOrigins()
      mockProductActor()
      vi.spyOn(
        MetaClient.prototype,
        "exchangeAuthorizationCode"
      ).mockRejectedValue(
        new ContractError({
          code: "provider_rejected",
          message: "The authorization code is invalid or expired.",
          status: 422,
        })
      )
      const saveToken = vi.spyOn(SqlRepository.prototype, "saveMetaUserToken")

      const error = await captureError(
        workerExports.WebAppApi.exchangeMetaAuthorizationCode(ACTOR, {
          code: "expired-code-must-not-cross",
          redirectUri: "https://app.resender.dev/api/meta/callback",
        })
      )

      expect(error).toMatchObject({
        code: "provider_rejected",
        status: 422,
      })
      expect(JSON.stringify(error)).not.toContain("expired-code-must-not-cross")
      expect(saveToken).not.toHaveBeenCalled()
    })
  })
})

function mockProductActor(overrides: Partial<UserRecord> = {}): void {
  vi.spyOn(SqlRepository.prototype, "getUserById").mockResolvedValue(
    runtimeUser(overrides)
  )
  vi.spyOn(SqlRepository.prototype, "getSubscription").mockResolvedValue(
    activeSubscription()
  )
}

function mockStripe(methods: object): void {
  vi.spyOn(stripeTransport, "create").mockReturnValue(methods as Stripe)
}

function setAllowedOrigins(): void {
  Reflect.set(
    env,
    "WEB_APP_ORIGINS",
    JSON.stringify(["https://app.resender.dev"])
  )
}

function runtimeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: ACTOR.userId,
    email: "person@example.com",
    passwordHash: "not-a-hash",
    waitlisted: false,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  }
}

function activeSubscription(
  overrides: Partial<SubscriptionRecord> = {}
): SubscriptionRecord {
  return {
    tenantId: ACTOR.userId,
    stripeSubscriptionId: "sub_internal",
    status: "active",
    priceLookupKey: "starter_monthly",
    currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    lastStripeEventAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  }
}

function runtimePage(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id: "f251bd5a-2772-489a-a725-43e2ea9d44ee",
    tenantId: ACTOR.userId,
    providerPageId: "page_1",
    name: "Page",
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenErrorAt: null,
    webhookUrl: null,
    pageAccessTokenEncrypted: "encrypted-page-token",
    webhookSigningSecretEncrypted: null,
    connectedAt: new Date(NOW),
    disconnectedAt: null,
    updatedAt: new Date(NOW),
    ...overrides,
  }
}

async function captureError(
  promise: Promise<unknown>
): Promise<Record<string, unknown>> {
  try {
    await promise
  } catch (error) {
    return error as Record<string, unknown>
  }
  throw new Error("Expected operation to reject")
}
