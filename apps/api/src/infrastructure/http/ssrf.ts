import { promises as dns } from "node:dns"
import { isIP } from "node:net"

import { ContractError } from "@workspace/contracts"

export type DnsResolver = {
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
}

const defaultResolver: DnsResolver = {
  resolve4: (hostname) => dns.resolve4(hostname),
  resolve6: (hostname) => dns.resolve6(hostname),
}

export function validateWebhookUrl(value: string | null): string | null {
  if (value === null) return null

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidWebhook("A valid webhook URL is required.")
  }

  if (url.protocol !== "https:") {
    throw invalidWebhook("Webhook URLs must use HTTPS.")
  }
  if (url.username || url.password) {
    throw invalidWebhook("Webhook URLs cannot include credentials.")
  }
  if (url.port && url.port !== "443") {
    throw invalidWebhook("Webhook URLs must use the default HTTPS port.")
  }
  if (isBlockedHostname(url.hostname)) {
    throw invalidWebhook("The webhook host is not allowed.")
  }
  return url.toString()
}

export async function assertPublicWebhookDestination(
  value: string,
  resolver: DnsResolver = defaultResolver
): Promise<void> {
  const normalized = validateWebhookUrl(value)
  if (!normalized) throw invalidWebhook("A webhook URL is required.")
  const hostname = new URL(normalized).hostname

  if (isIP(stripIpv6Brackets(hostname))) {
    if (isPrivateOrReservedIp(stripIpv6Brackets(hostname))) {
      throw invalidWebhook("The webhook host resolves to a private address.")
    }
    return
  }

  const [ipv4, ipv6] = await Promise.all([
    resolver.resolve4(hostname).catch(() => []),
    resolver.resolve6(hostname).catch(() => []),
  ])
  const addresses = [...ipv4, ...ipv6]
  if (addresses.length === 0) {
    throw invalidWebhook("The webhook host could not be resolved.")
  }
  if (addresses.some(isPrivateOrReservedIp)) {
    throw invalidWebhook("The webhook host resolves to a private address.")
  }
}

export function isPrivateOrReservedIp(value: string): boolean {
  const ip = stripIpv6Brackets(value).toLowerCase()
  const version = isIP(ip)
  if (version === 4) return isBlockedIpv4(ip)
  if (version === 6) return isBlockedIpv6(ip)
  return true
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLowerCase()
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    (isIP(normalized) !== 0 && isPrivateOrReservedIp(normalized))
  )
}

function isBlockedIpv4(value: string): boolean {
  const parts = value.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true
  }
  const [a = 0, b = 0] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  )
}

function isBlockedIpv6(value: string): boolean {
  const expanded = expandIpv6(value)
  if (!expanded) return true
  const first = Number.parseInt(expanded[0] ?? "0", 16)
  const second = Number.parseInt(expanded[1] ?? "0", 16)
  return (
    expanded.every((group) => group === "0000") ||
    expanded.join(":") === "0000:0000:0000:0000:0000:0000:0000:0001" ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8) ||
    isBlockedIpv4Mapped(expanded)
  )
}

function isBlockedIpv4Mapped(groups: string[]): boolean {
  const prefix = groups.slice(0, 5).every((group) => group === "0000")
  if (!prefix || groups[5] !== "ffff") return false
  const high = Number.parseInt(groups[6] ?? "0", 16)
  const low = Number.parseInt(groups[7] ?? "0", 16)
  const ipv4 = [high >> 8, high & 255, low >> 8, low & 255].join(".")
  return isBlockedIpv4(ipv4)
}

function expandIpv6(value: string): string[] | null {
  const [leftText, rightText, extra] = value.split("::")
  if (extra !== undefined) return null
  const left = leftText ? leftText.split(":") : []
  const right = rightText ? rightText.split(":") : []
  const normalizedRight = normalizeIpv4Tail(right)
  const normalizedLeft = normalizeIpv4Tail(left)
  if (!normalizedRight || !normalizedLeft) return null
  const missing = 8 - normalizedLeft.length - normalizedRight.length
  if (
    (value.includes("::") && missing < 1) ||
    (!value.includes("::") && missing !== 0)
  ) {
    return null
  }
  const groups = [
    ...normalizedLeft,
    ...Array.from({ length: missing }, () => "0"),
    ...normalizedRight,
  ]
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/iu.test(group))
  ) {
    return null
  }
  return groups.map((group) => group.padStart(4, "0").toLowerCase())
}

function normalizeIpv4Tail(groups: string[]): string[] | null {
  if (groups.length === 0) return []
  const last = groups.at(-1)
  if (!last?.includes(".")) return groups
  if (isIP(last) !== 4) return null
  const parts = last.split(".").map(Number)
  return [
    ...groups.slice(0, -1),
    ((parts[0] ?? 0) * 256 + (parts[1] ?? 0)).toString(16),
    ((parts[2] ?? 0) * 256 + (parts[3] ?? 0)).toString(16),
  ]
}

function stripIpv6Brackets(value: string): string {
  return value.replace(/^\[|\]$/gu, "")
}

function invalidWebhook(message: string): ContractError {
  return new ContractError({
    code: "validation_error",
    message,
    status: 400,
    details: [{ path: "webhookUrl", message }],
  })
}
