import { readFile } from "node:fs/promises"

import { beforeEach, describe, expect, it, vi } from "vitest"

const openNext = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
}))

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: openNext.getCloudflareContext,
}))

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
  getBackend,
  smokeBackend,
} from "./backend"

type AdapterBackend = Awaited<ReturnType<typeof getBackend>>
type AdapterExposesFetcher = "fetch" extends keyof AdapterBackend ? true : false
const ADAPTER_EXPOSES_FETCHER: AdapterExposesFetcher = false

describe("backend RPC adapter", () => {
  beforeEach(() => {
    openNext.getCloudflareContext.mockReset()
  })

  it("resolves the async OpenNext context for every call", async () => {
    const health = vi
      .fn()
      .mockResolvedValue({
        status: "ok",
        service: "api",
        entrypoint: "rpc",
      })
    const fetch = vi.fn()
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { fetch, health } },
    })

    await expect(smokeBackend()).resolves.toEqual({
      status: "ok",
      service: "api",
      entrypoint: "rpc",
    })
    await getBackend()

    expect(openNext.getCloudflareContext).toHaveBeenCalledTimes(2)
    expect(openNext.getCloudflareContext).toHaveBeenNthCalledWith(1, {
      async: true,
    })
    expect(openNext.getCloudflareContext).toHaveBeenNthCalledWith(2, {
      async: true,
    })
    expect(health).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    expect(ADAPTER_EXPOSES_FETCHER).toBe(false)
  })

  it("fails with a generic error when the OpenNext context is unavailable", async () => {
    openNext.getCloudflareContext.mockRejectedValue(
      new Error("DATABASE_URL=must-not-leak")
    )

    const error = await captureError(getBackend())

    expect(error).toBeInstanceOf(BackendUnavailableError)
    expect(String(error)).toBe(
      "BackendUnavailableError: Backend service is unavailable."
    )
    expect(JSON.stringify(error)).not.toMatch(/DATABASE_URL|must-not-leak/u)
  })

  it("fails with the same generic error when BACKEND is missing", async () => {
    openNext.getCloudflareContext.mockResolvedValue({ env: {} })

    await expect(getBackend()).rejects.toThrowError(BackendUnavailableError)
    await expect(getBackend()).rejects.toThrow("Backend service is unavailable.")
  })

  it("classifies backend failures without retaining raw messages", async () => {
    const health = vi.fn().mockRejectedValue({
      code: "provider_unavailable",
      status: 502,
      message: "provider-token=must-not-leak",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { health } },
    })

    const error = await captureError(smokeBackend())
    if (!(error instanceof BackendRpcError)) {
      throw new Error("Expected BackendRpcError")
    }

    expect(error.message).toBe("Backend request failed.")
    expect(error.classification).toEqual({
      kind: "transient",
      code: "provider_unavailable",
      status: 502,
      retryable: true,
    })
    expect(JSON.stringify(error)).not.toMatch(/provider-token|must-not-leak/u)
  })

  it("rejects malformed health DTOs without retaining the response", async () => {
    const health = vi.fn().mockResolvedValue({
      status: "ok",
      service: "api",
      entrypoint: "rpc",
      secret: "must-not-leak",
    })
    openNext.getCloudflareContext.mockResolvedValue({
      env: { BACKEND: { health } },
    })

    const error = await captureError(smokeBackend())

    expect(error).toBeInstanceOf(BackendProtocolError)
    expect(String(error)).toBe(
      "BackendProtocolError: Backend response is invalid."
    )
    expect(JSON.stringify(error)).not.toMatch(/secret|must-not-leak/u)
  })

  it("keeps the adapter guarded by Next server-only", async () => {
    const source = await readFile(new URL("./backend.ts", import.meta.url), "utf8")

    expect(source.startsWith('import "server-only"')).toBe(true)
  })
})

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("Expected promise to reject")
}
