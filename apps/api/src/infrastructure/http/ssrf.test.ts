import { describe, expect, it } from "vitest"

import {
  assertPublicWebhookDestination,
  isPrivateOrReservedIp,
  validateWebhookUrl,
} from "./ssrf"

describe("webhook SSRF controls", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.2",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("blocks private or reserved address %s", (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(true)
  })

  it.each([
    "http://example.com/hook",
    "https://user:pass@example.com/hook",
    "https://localhost/hook",
    "https://example.com:8443/hook",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => validateWebhookUrl(url)).toThrow()
  })

  it("rechecks resolved addresses at delivery time", async () => {
    await expect(
      assertPublicWebhookDestination("https://hooks.example.com/path", {
        resolve4: async () => ["10.0.0.2"],
        resolve6: async () => [],
      })
    ).rejects.toThrow("private address")
  })

  it("accepts a public destination only when DNS has public addresses", async () => {
    await expect(
      assertPublicWebhookDestination("https://hooks.example.com/path", {
        resolve4: async () => ["93.184.216.34"],
        resolve6: async () => ["2606:2800:220:1:248:1893:25c8:1946"],
      })
    ).resolves.toBeUndefined()
  })
})
