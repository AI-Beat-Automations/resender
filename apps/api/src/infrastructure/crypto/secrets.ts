import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto"
import { promisify } from "node:util"

import { ContractError } from "@workspace/contracts"

const scrypt = promisify(scryptCallback)
const PASSWORD_KEY_LENGTH = 64
const PASSWORD_FORMAT = "scrypt"
const API_KEY_PREFIX = "pk_live_"
const WEBHOOK_SECRET_PREFIX = "whsec_"
const INTEGRATION_IDENTIFIER_ALPHABET = "abcdefghijklmnopqrstuvwxyz"

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password)
  const salt = randomBytes(16).toString("base64url")
  const derived = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer
  return `${PASSWORD_FORMAT}$${salt}$${derived.toString("base64url")}`
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [format, salt, hash] = storedHash.split("$")
  if (format !== PASSWORD_FORMAT || !salt || !hash) return false
  const expected = Buffer.from(hash, "base64url")
  const derived = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  )
}

export function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new ContractError({
      code: "validation_error",
      message: "The password must contain at least 8 characters.",
      status: 400,
      details: [
        {
          path: "password",
          message: "Must contain at least 8 characters",
        },
      ],
    })
  }
}

export async function generateApiKey(pepper: string): Promise<{
  apiKey: string
  visiblePrefix: string
  secretHash: string
}> {
  const secret = randomToken(32)
  const apiKey = `${API_KEY_PREFIX}${secret}`
  return {
    apiKey,
    visiblePrefix: `${API_KEY_PREFIX}${secret.slice(0, 8)}`,
    secretHash: await hmacBase64Url(pepper, apiKey),
  }
}

export async function hashApiKey(
  pepper: string,
  apiKey: string
): Promise<string> {
  return hmacBase64Url(pepper, apiKey)
}

export function isApiKeyFormat(value: string): boolean {
  return (
    value.startsWith(API_KEY_PREFIX) && value.length > API_KEY_PREFIX.length
  )
}

export function generateWebhookSigningSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomToken(32)}`
}

export function generateIntegrationIdentifier(): string {
  let suffix = ""
  while (suffix.length < 8) {
    for (const byte of randomBytes(16)) {
      // 234 is the largest multiple of 26 below 256. Discarding the tail
      // avoids modulo bias while keeping the suffix cryptographically random.
      if (byte >= 234) continue
      suffix += INTEGRATION_IDENTIFIER_ALPHABET[byte % 26]
      if (suffix.length === 8) break
    }
  }
  return `resender_${suffix}`
}

export function encryptSecret(keyValue: string, plaintext: string): string {
  const key = encryptionKey(keyValue)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted]
    .map((part) => part.toString("base64url"))
    .join(".")
}

export function decryptSecret(keyValue: string, ciphertext: string): string {
  const [ivText, tagText, encryptedText] = ciphertext.split(".")
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("invalid encrypted payload")
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(keyValue),
    Buffer.from(ivText, "base64url")
  )
  decipher.setAuthTag(Buffer.from(tagText, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return bytesToHex(new Uint8Array(digest))
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function safeEqualText(
  left: string,
  right: string
): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ])
  return timingSafeEqual(Buffer.from(leftHash), Buffer.from(rightHash))
}

function randomToken(length: number): string {
  return randomBytes(length).toString("base64url")
}

async function hmacBase64Url(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const result = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  )
  return bytesToBase64Url(result)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value, value.length === 64 ? "hex" : "base64")
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes")
  }
  return key
}
