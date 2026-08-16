import { describe, expect, it, vi } from "vitest"
import { ContractError, ERROR_CODES } from "@workspace/contracts"

import type { ApiService } from "../application/service"
import {
  createApp,
  getOpenApiDocument,
  getRegisteredPublicV1Routes,
} from "./app"

describe("OpenAPI document", () => {
  it("documents every public v1 route and no provider callback", () => {
    const app = createApp()
    const document = getOpenApiDocument(app)
    const documented = Object.entries(document.paths ?? {}).flatMap(
      ([path, operations]) =>
        Object.keys(operations ?? {})
          .filter((method) =>
            ["get", "post", "put", "patch", "delete"].includes(method)
          )
          .map((method) => `${method.toUpperCase()} ${path}`)
    )
    expect(documented.sort()).toEqual(getRegisteredPublicV1Routes(app).sort())
    expect(document.paths).not.toHaveProperty("/webhooks/meta")
    expect(document.paths).not.toHaveProperty("/webhooks/stripe")
  })

  it("uses OpenAPI 3.1, canonical servers, and bearer auth", () => {
    const document = getOpenApiDocument(createApp())
    expect(document.openapi).toBe("3.1.0")
    expect(document.info.version).toBe("1.0.0")
    expect(document.servers?.map((server) => server.url)).toEqual([
      "https://api.resender.dev",
      "http://localhost:8787",
    ])
    expect(document.components?.securitySchemes).toHaveProperty("bearerAuth")
  })

  it("includes concrete response bodies and the canonical error enum", () => {
    const document = getOpenApiDocument(createApp())
    for (const operations of Object.values(document.paths ?? {})) {
      for (const operation of Object.values(operations ?? {})) {
        if (
          !operation ||
          typeof operation !== "object" ||
          !("responses" in operation)
        ) {
          continue
        }
        const responses = operation.responses as Record<
          string,
          {
            content?: Record<
              string,
              {
                example?: unknown
                schema?: { properties?: Record<string, unknown> }
              }
            >
          }
        >
        expect(
          responses["200"]?.content?.["application/json"]?.example ??
            responses["201"]?.content?.["application/json"]?.example
        ).toBeDefined()
        const errorSchema = responses["400"]?.content?.["application/json"]
          ?.schema as
          | {
              properties?: {
                error?: { properties?: { code?: { enum?: string[] } } }
              }
            }
          | undefined
        expect(errorSchema?.properties?.error?.properties?.code?.enum).toEqual(
          ERROR_CODES
        )
      }
    }
  })

  it("matches the reviewed API snapshot", () => {
    expect(getOpenApiDocument(createApp())).toMatchSnapshot()
  })

  it("serves health and identical inline/download documents without dependencies", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const app = createApp()
    const environment = {
      META_APP_ID: "",
      META_APP_SECRET: "",
      DATABASE_URL: "",
    } as Env
    const health = await app.request(
      "http://localhost/healthz",
      {},
      environment
    )
    const inline = await app.request(
      "http://localhost/openapi.json",
      {},
      environment
    )
    const download = await app.request(
      "http://localhost/openapi/download",
      {},
      environment
    )

    expect(health.status).toBe(200)
    expect(health.headers.get("x-request-id")).toBeTruthy()
    expect(await inline.json()).toEqual(await download.json())
    expect(download.headers.get("content-disposition")).toContain(
      "resender-openapi-v1.json"
    )
    log.mockRestore()
  })

  it("rejects an oversized callback before parsing or signature verification", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const response = await createApp().request(
      "http://localhost/webhooks/meta",
      {
        method: "POST",
        body: "x".repeat(256 * 1024 + 1),
      },
      {
        META_APP_ID: "",
        META_APP_SECRET: "",
        DATABASE_URL: "",
      } as Env
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: { code: "validation_error" },
    })
    warn.mockRestore()
    info.mockRestore()
  })

  it("accepts the documented idempotency header at runtime", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const sendMessage = vi.fn(async () => ({
      replayed: false,
      created: true,
      message: {
        id: "ef55c94e-b861-4d19-9f9b-b5689028de80",
        conversationId: "9e2327a8-0c42-493e-bd6c-c08ed81010f0",
        pageId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
        contactId: "psid",
        direction: "outbound" as const,
        status: "sent" as const,
        type: "text" as const,
        text: "hello",
        provider: { name: "meta" as const, messageId: "mid.1" },
        failure: null,
        createdAt: "2026-07-29T18:00:00.000Z",
      },
    }))
    const app = createApp({
      serviceFactory: () =>
        ({
          authenticateApiKey: async () => ({
            tenantId: "6b402566-9e1d-4739-bb61-81ac615a5469",
            apiKeyId: "key_1",
          }),
          requireProductAccess: async () => ({
            user: {},
            subscription: {},
          }),
          sendMessage,
        }) as unknown as ApiService,
    })
    const response = await app.request(
      "http://localhost/v1/messages",
      {
        method: "POST",
        headers: {
          authorization: "Bearer pk_live_test",
          "content-type": "application/json",
          "Idempotency-Key": "order-1",
        },
        body: JSON.stringify({
          pageId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
          recipientId: "psid",
          type: "text",
          text: "hello",
        }),
      },
      {
        API_RATE_LIMITER: {
          limit: async () => ({ success: true }),
        },
      } as unknown as Env
    )
    expect(response.status).toBe(201)
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "order-1" })
    )
    info.mockRestore()
  })

  it.each([
    ["account_waitlisted", "This account is still on the waitlist."],
    ["subscription_required", "An active subscription is required."],
  ] as const)(
    "applies the %s product gate to every registered public route",
    async (code, message) => {
      const info = vi.spyOn(console, "log").mockImplementation(() => undefined)
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const app = createApp({
        serviceFactory: () =>
          ({
            authenticateApiKey: async () => ({
              tenantId: "6b402566-9e1d-4739-bb61-81ac615a5469",
              apiKeyId: "key_1",
            }),
            requireProductAccess: async () => {
              throw new ContractError({ code, message, status: 403 })
            },
          }) as unknown as ApiService,
      })
      for (const registered of getRegisteredPublicV1Routes(app)) {
        const [method, path] = registered.split(" ")
        const concretePath = path
          ?.replace("{pageId}", "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15")
          .replace("{conversationId}", "9e2327a8-0c42-493e-bd6c-c08ed81010f0")
          .replace("{messageId}", "ef55c94e-b861-4d19-9f9b-b5689028de80")
          .replace("{commentId}", "1f0c9b2e-6d2a-4a5f-9f43-2f9a4b6d0c11")
        const response = await app.request(
          `http://localhost${concretePath}`,
          { method },
          {
            API_RATE_LIMITER: {
              limit: async () => ({ success: true }),
            },
          } as unknown as Env
        )
        expect(response.status, registered).toBe(403)
        expect(await response.json(), registered).toMatchObject({
          error: { code },
        })
      }
      info.mockRestore()
      warn.mockRestore()
    }
  )

  // Gemelo del anterior para el permiso de canal (ADR 0010). No es una fila más
  // de esa tabla a propósito: el gate **no** vive dentro de
  // `requireProductAccess` —ahí bloquearía también a Messenger—, así que
  // mockearlo no probaría el camino real. Recorrer las rutas registradas y no
  // una lista escrita a mano es lo que garantiza que una ruta de comentarios
  // nueva no nazca sin permiso.
  it("applies the Instagram channel gate to every registered comments route", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const requireInstagramAccess = vi.fn(async () => {
      throw new ContractError({
        code: "channel_not_enabled",
        message: "The Instagram channel is not enabled for this account.",
        status: 403,
      })
    })
    const app = createApp({
      serviceFactory: () =>
        ({
          authenticateApiKey: async () => ({
            tenantId: "6b402566-9e1d-4739-bb61-81ac615a5469",
            apiKeyId: "key_1",
          }),
          requireProductAccess: async () => ({ user: {}, subscription: {} }),
          requireInstagramAccess,
        }) as unknown as ApiService,
    })
    const commentRoutes = getRegisteredPublicV1Routes(app).filter(
      (registered) => registered.split(" ")[1]?.startsWith("/v1/comments")
    )
    expect(commentRoutes).toHaveLength(5)

    for (const registered of commentRoutes) {
      const [method, path] = registered.split(" ")
      const response = await app.request(
        `http://localhost${path?.replace(
          "{commentId}",
          "1f0c9b2e-6d2a-4a5f-9f43-2f9a4b6d0c11"
        )}`,
        { method },
        {
          API_RATE_LIMITER: {
            limit: async () => ({ success: true }),
          },
        } as unknown as Env
      )
      expect(response.status, registered).toBe(403)
      expect(await response.json(), registered).toMatchObject({
        error: { code: "channel_not_enabled" },
      })
    }
    expect(requireInstagramAccess).toHaveBeenCalledTimes(commentRoutes.length)
    info.mockRestore()
    warn.mockRestore()
  })
})
