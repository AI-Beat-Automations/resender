import { readFile } from "node:fs/promises"

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/backend/backend", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/backend/backend")>()
  return {
    ...original,
    createApiKey: mocks.createApiKey,
    revokeApiKey: mocks.revokeApiKey,
  }
})

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
} from "@/lib/backend/backend"

import { createApiKeyAction, revokeApiKeyAction } from "./actions"

const ACTOR_ID = "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15"
const API_KEY_ID = "61c94a3a-c22f-47f8-ab1f-b797307cea31"
const API_KEY = `pk_live_${"a".repeat(43)}`
const REDIRECT = new Error("NEXT_REDIRECT")

describe("API key Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: ACTOR_ID } })
    mocks.redirect.mockImplementation(() => {
      throw REDIRECT
    })
  })

  it("authenticates every action independently", async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(createApiKeyAction({}, createForm())).resolves.toEqual({
      error: "No hay sesión iniciada.",
    })
    await expect(revokeApiKeyAction({}, revokeForm())).resolves.toEqual({
      error: "No hay sesión iniciada.",
    })
    expect(mocks.auth).toHaveBeenCalledTimes(2)
    expect(mocks.createApiKey).not.toHaveBeenCalled()
    expect(mocks.revokeApiKey).not.toHaveBeenCalled()
  })

  it.each([
    ["empty", ""],
    ["spaces", "   "],
    ["too long", "a".repeat(81)],
  ])("rejects an %s label before RPC", async (_name, label) => {
    const result = await createApiKeyAction({}, createForm(label))

    expect(result.error).toBeDefined()
    expect(mocks.createApiKey).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects a non-string label before RPC", async () => {
    const form = new FormData()
    form.set("label", new File(["x"], "label.txt"))

    await expect(createApiKeyAction({}, form)).resolves.toEqual({
      error: "Escribe una etiqueta para la key.",
    })
    expect(mocks.createApiKey).not.toHaveBeenCalled()
  })

  it("reveals a created key once without resubmitting previous action state", async () => {
    mocks.createApiKey.mockResolvedValue({
      apiKey: API_KEY,
      record: apiKey(),
    })

    const result = await createApiKeyAction(
      { apiKey: "pk_live_OLD_SECRET" },
      createForm("  Production  ")
    )

    expect(mocks.createApiKey).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      { label: "Production" }
    )
    expect(JSON.stringify(mocks.createApiKey.mock.calls)).not.toContain(
      "OLD_SECRET"
    )
    expect(result).toEqual({
      apiKey: API_KEY,
      message: "Copia la key ahora: no vamos a volver a mostrarla.",
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings")
  })

  it("validates revoke ids before RPC", async () => {
    await expect(
      revokeApiKeyAction({}, revokeForm("foreign-or-malformed"))
    ).resolves.toEqual({ error: "La API key no es válida." })
    expect(mocks.revokeApiKey).not.toHaveBeenCalled()
  })

  it("revokes by exact actor/id and revalidates only after success", async () => {
    mocks.revokeApiKey.mockResolvedValue(
      apiKey({
        status: "revoked",
        revokedAt: "2026-07-30T19:00:00.000Z",
      })
    )

    await expect(revokeApiKeyAction({}, revokeForm())).resolves.toEqual({
      message: "API key revocada.",
    })
    expect(mocks.revokeApiKey).toHaveBeenCalledWith(
      { userId: ACTOR_ID },
      { apiKeyId: API_KEY_ID }
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings")
  })

  it.each([
    [
      "waitlisted",
      "create",
      rpcError("account_waitlisted", "access", 403),
      "/waitlist",
    ],
    [
      "unsubscribed",
      "create",
      rpcError("subscription_required", "access", 403),
      "/billing",
    ],
    [
      "deleted account",
      "create",
      rpcError("not_found", "not_found", 404),
      "/waitlist",
    ],
    [
      "waitlisted revoke",
      "revoke",
      rpcError("account_waitlisted", "access", 403),
      "/waitlist",
    ],
    [
      "unsubscribed revoke",
      "revoke",
      rpcError("subscription_required", "access", 403),
      "/billing",
    ],
  ] as const)(
    "redirects an access race: %s",
    async (_name, operation, error, destination) => {
      const rpc =
        operation === "create" ? mocks.createApiKey : mocks.revokeApiKey
      rpc.mockRejectedValue(error)

      const result =
        operation === "create"
          ? createApiKeyAction({}, createForm())
          : revokeApiKeyAction({}, revokeForm())

      await expect(result).rejects.toBe(REDIRECT)
      expect(mocks.redirect).toHaveBeenCalledWith(destination)
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    }
  )

  it("keeps a missing/foreign revoke inline and sanitized", async () => {
    mocks.revokeApiKey.mockRejectedValue(
      rpcError("not_found", "not_found", 404)
    )

    await expect(revokeApiKeyAction({}, revokeForm())).resolves.toEqual({
      error: "No encontramos la API key.",
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    ["create", rpcError("validation_error", "validation", 400)],
    ["revoke", rpcError("validation_error", "validation", 400)],
  ] as const)(
    "returns controlled validation copy for %s",
    async (operation, error) => {
      const rpc =
        operation === "create" ? mocks.createApiKey : mocks.revokeApiKey
      rpc.mockRejectedValue(error)

      const result =
        operation === "create"
          ? await createApiKeyAction({}, createForm())
          : await revokeApiKeyAction({}, revokeForm())

      expect(result.error).toBeDefined()
      expect(JSON.stringify(result)).not.toMatch(/SECRET|hash|pepper/u)
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each([
    new BackendUnavailableError(),
    new BackendProtocolError(),
    rpcError("internal_error", "internal", 500),
    rpcError("provider_unavailable", "transient", 502),
  ])("fails closed for backend/protocol errors", async (error) => {
    mocks.createApiKey.mockRejectedValue(error)

    await expect(createApiKeyAction({}, createForm())).rejects.toBe(error)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("keeps the full key out of URLs, cookies, hidden inputs, logs, and analytics", async () => {
    const [actions, form] = await Promise.all([
      readFile(new URL("./actions.ts", import.meta.url), "utf8"),
      readFile(
        new URL("./ui/create-api-key-form.tsx", import.meta.url),
        "utf8"
      ),
    ])
    const source = `${actions}\n${form}`

    expect(form).not.toMatch(/name=["']apiKey["']/u)
    expect(source).not.toMatch(
      /cookies\(|searchParams|console\.(?:log|info|warn|error)/u
    )
    expect(form).toMatch(/se muestra una sola vez/u)
  })
})

function createForm(label = "Production") {
  const form = new FormData()
  form.set("label", label)
  return form
}

function revokeForm(id = API_KEY_ID) {
  const form = new FormData()
  form.set("apiKeyId", id)
  return form
}

function apiKey(overrides: Record<string, unknown> = {}) {
  return {
    id: API_KEY_ID,
    label: "Production",
    visiblePrefix: "pk_live_aaaaaaaa",
    status: "active",
    createdAt: "2026-07-30T18:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

function rpcError(
  code:
    | "account_waitlisted"
    | "subscription_required"
    | "not_found"
    | "validation_error"
    | "internal_error"
    | "provider_unavailable",
  kind: "access" | "not_found" | "validation" | "internal" | "transient",
  status: 400 | 403 | 404 | 500 | 502
) {
  return new BackendRpcError({
    code,
    kind,
    status,
    retryable: kind === "transient",
  })
}
