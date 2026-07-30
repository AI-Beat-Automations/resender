import { readFile } from "node:fs/promises"

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  disconnectPage: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  updatePageWebhook: vi.fn(),
  posthogCapture: vi.fn(),
  posthogFlush: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/posthog", () => ({
  posthog: {
    capture: mocks.posthogCapture,
    flush: mocks.posthogFlush,
  },
}))
vi.mock("@/lib/backend/backend", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/backend/backend")>()
  return {
    ...original,
    disconnectPage: mocks.disconnectPage,
    rotateWebhookSecret: mocks.rotateWebhookSecret,
    updatePageWebhook: mocks.updatePageWebhook,
  }
})

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import {
  disconnectPageAction,
  rotateWebhookSecretAction,
  saveWebhookUrlAction,
} from "./actions"

const ACTOR_ID = "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"
const PAGE_ID = "f251bd5a-2772-489a-a725-43e2ea9d44ee"
const REDIRECT_SENTINEL = new Error("NEXT_REDIRECT")

describe("Connection Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: ACTOR_ID } })
    mocks.redirect.mockImplementation(() => {
      throw REDIRECT_SENTINEL
    })
  })

  it("authenticates each action and stops before RPC without a session", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(saveWebhookUrlAction({}, webhookForm())).resolves.toEqual({
      error: "No has iniciado sesión.",
    })
    await expect(disconnectPageAction({}, pageForm())).resolves.toEqual({
      error: "No has iniciado sesión.",
    })
    await expect(rotateWebhookSecretAction({}, pageForm())).resolves.toEqual({
      error: "No has iniciado sesión.",
    })

    expect(mocks.auth).toHaveBeenCalledTimes(3)
    expect(mocks.updatePageWebhook).not.toHaveBeenCalled()
    expect(mocks.disconnectPage).not.toHaveBeenCalled()
    expect(mocks.rotateWebhookSecret).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-uuid"],
  ])("rejects a %s Page id before RPC", async (_name, value) => {
    const form = new FormData()
    if (value) form.set("connectionId", value)
    form.set("webhookUrl", "https://example.com/hook")

    await expect(saveWebhookUrlAction({}, form)).resolves.toEqual({
      error: "Página inválida.",
    })
    expect(mocks.updatePageWebhook).not.toHaveBeenCalled()
  })

  it("trims and canonicalizes HTTPS URLs and sends only the session actor", async () => {
    mocks.updatePageWebhook.mockResolvedValue(pageDto())

    await expect(
      saveWebhookUrlAction({}, webhookForm("  https://example.com/hook?q=1  "))
    ).resolves.toEqual({ message: "Webhook actualizado." })

    expect(mocks.updatePageWebhook).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      {
        pageId: PAGE_ID,
        webhookUrl: "https://example.com/hook?q=1",
      }
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
    expect(mocks.posthogCapture).toHaveBeenCalledWith({
      distinctId: ACTOR_ID,
      event: "webhook url saved",
      properties: {
        connection_id: PAGE_ID,
        page_id: "provider-page",
      },
    })
  })

  it("normalizes an empty webhook as null", async () => {
    mocks.updatePageWebhook.mockResolvedValue(pageDto())

    await saveWebhookUrlAction({}, webhookForm("   "))

    expect(mocks.updatePageWebhook).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      { pageId: PAGE_ID, webhookUrl: null }
    )
  })

  it.each([
    "http://localhost:3000/hook",
    "http://127.0.0.1/hook",
    "http://example.com/hook",
  ])("rejects HTTP without invoking the backend: %s", async (url) => {
    await expect(
      saveWebhookUrlAction({}, webhookForm(url))
    ).resolves.toMatchObject({
      error: expect.stringMatching(/HTTPS.*túnel HTTPS/u),
    })
    expect(mocks.updatePageWebhook).not.toHaveBeenCalled()
  })

  it("rejects a non-string webhook FormData entry before RPC", async () => {
    const form = pageForm()
    form.set("webhookUrl", new File(["x"], "hook.txt"))

    await expect(saveWebhookUrlAction({}, form)).resolves.toEqual({
      error: "Escribe una URL válida.",
    })
    expect(mocks.updatePageWebhook).not.toHaveBeenCalled()
  })

  it("disconnects through RPC and preserves history semantics", async () => {
    mocks.disconnectPage.mockResolvedValue(pageDto({ status: "disconnected" }))

    await expect(disconnectPageAction({}, pageForm())).resolves.toEqual({
      message: "Página desconectada. El historial se conserva.",
    })
    expect(mocks.disconnectPage).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      { pageId: PAGE_ID }
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
    expect(mocks.posthogCapture).toHaveBeenCalledWith({
      distinctId: ACTOR_ID,
      event: "page disconnected",
      properties: {
        connection_id: PAGE_ID,
        page_id: "provider-page",
        page_name: "Support",
      },
    })
  })

  it("reveals a rotated secret once, revalidates, and never resubmits old state", async () => {
    mocks.rotateWebhookSecret.mockResolvedValue({
      secret: "whsec_new_once",
      createdAt: "2026-07-29T18:03:00.000Z",
    })

    const result = await rotateWebhookSecretAction(
      {
        secret: "whsec_OLD_SECRET",
        secretCreatedAt: "2026-01-01T00:00:00.000Z",
      },
      pageForm()
    )

    expect(mocks.rotateWebhookSecret).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      { pageId: PAGE_ID }
    )
    expect(mocks.rotateWebhookSecret.mock.calls[0]).not.toContain(
      "whsec_OLD_SECRET"
    )
    expect(result).toEqual({
      message: "Secreto creado. Cópialo ahora: no volveremos a mostrarlo.",
      secret: "whsec_new_once",
      secretCreatedAt: "2026-07-29T18:03:00.000Z",
    })
    expect(JSON.stringify(result)).not.toContain("OLD_SECRET")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
    expect(mocks.posthogCapture).not.toHaveBeenCalled()
  })

  it.each([
    [rpcError("account_waitlisted", "access", 403), "/waitlist"],
    [rpcError("subscription_required", "access", 403), "/billing"],
  ] as const)(
    "redirects access races outside the mutation catch",
    async (error, path) => {
      mocks.disconnectPage.mockRejectedValue(error)

      await expect(disconnectPageAction({}, pageForm())).rejects.toBe(
        REDIRECT_SENTINEL
      )
      expect(mocks.redirect).toHaveBeenCalledWith(path)
    }
  )

  it.each([
    [
      rpcError("not_found", "not_found", 404),
      "No encontramos una página activa con ese identificador.",
    ],
    [
      rpcError("validation_error", "validation", 400),
      "Revisa que uses HTTPS, un destino público y un secreto de firma activo.",
    ],
  ] as const)("returns sanitized expected form errors", async (error, copy) => {
    mocks.updatePageWebhook.mockRejectedValue(error)

    await expect(saveWebhookUrlAction({}, webhookForm())).resolves.toEqual({
      error: copy,
    })
    expect(JSON.stringify(await safeErrorJson(error))).not.toContain(
      "access_token"
    )
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    new BackendUnavailableError(),
    new BackendProtocolError(),
    rpcError("provider_unavailable", "transient", 502),
    rpcError("internal_error", "internal", 500),
  ])("fails closed for unexpected backend failures", async (error) => {
    mocks.updatePageWebhook.mockRejectedValue(error)

    await expect(saveWebhookUrlAction({}, webhookForm())).rejects.toBe(error)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("keeps secrets out of hidden inputs, URLs, cookies, logs, and analytics", async () => {
    const [actionsSource, cardSource] = await Promise.all([
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
      readFile(
        new URL("./ui/connected-page-card.tsx", import.meta.url),
        "utf8"
      ),
    ])
    const source = `${actionsSource}\n${cardSource}`

    expect(cardSource).not.toMatch(/name=["'](?:secret|webhookSecret)["']/u)
    expect(source).not.toMatch(
      /cookies\(|console\.(?:log|info|error)|searchParams/u
    )
    expect(cardSource).toMatch(/se muestra una sola vez/u)
    expect(cardSource).toMatch(/invalidado inmediatamente/u)
    expect(cardSource).toMatch(/¿Rotar el secreto de firma\?/u)
    expect(cardSource).toMatch(/Sí, rotar e invalidar el anterior/u)
    expect(cardSource).toMatch(
      /setTimeout\(\(\) => setRotateDialogOpen\(false\), 0\)/u
    )
    expect(cardSource).toMatch(/open=\{rotateDialogOpen\}/u)
    expect(cardSource).toMatch(
      /<DialogContent[\s\S]*\{rotateState\.error && \([\s\S]*\{rotateState\.error\}/u
    )
    expect(cardSource).toMatch(
      /signingEnabled \|\| webhookUrl\.trim\(\) === ""/u
    )
  })
})

function pageForm() {
  const form = new FormData()
  form.set("connectionId", PAGE_ID)
  return form
}

function webhookForm(url = "https://example.com/hook") {
  const form = pageForm()
  form.set("webhookUrl", url)
  return form
}

function rpcError(
  code:
    | "account_waitlisted"
    | "subscription_required"
    | "not_found"
    | "validation_error"
    | "provider_unavailable"
    | "internal_error",
  kind: "access" | "not_found" | "validation" | "transient" | "internal",
  status: 400 | 403 | 404 | 500 | 502
) {
  return new BackendRpcError({
    code,
    kind,
    status,
    retryable: kind === "transient",
  })
}

async function safeErrorJson(error: unknown) {
  return JSON.stringify(error)
}

function pageDto(overrides: Record<string, unknown> = {}) {
  return {
    id: PAGE_ID,
    provider: "meta",
    providerPageId: "provider-page",
    name: "Support",
    status: "active",
    tokenStatus: "valid",
    tokenError: null,
    tokenErrorAt: null,
    disconnectedAt: null,
    webhook: { url: null, signingEnabled: true },
    connectedAt: "2026-07-29T18:00:00.000Z",
    updatedAt: "2026-07-29T18:00:00.000Z",
    ...overrides,
  }
}
