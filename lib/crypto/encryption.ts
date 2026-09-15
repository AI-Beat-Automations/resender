import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"

export class SecretEncryptionConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SecretEncryptionConfigError"
  }
}

export function encryptSecret(plainText: string) {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [iv, tag, encrypted]
    .map((part) => part.toString("base64url"))
    .join(".")
}

export function decryptSecret(cipherText: string) {
  const [ivText, tagText, encryptedText] = cipherText.split(".")
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("invalid encrypted payload")
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivText, "base64url")
  )
  decipher.setAuthTag(Buffer.from(tagText, "base64url"))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

export function assertSecretEncryptionConfigured() {
  getEncryptionKey()
}

function getEncryptionKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new SecretEncryptionConfigError("TOKEN_ENCRYPTION_KEY is required")
  }

  const key = Buffer.from(raw, raw.length === 64 ? "hex" : "base64")
  if (key.length !== 32) {
    throw new SecretEncryptionConfigError(
      "TOKEN_ENCRYPTION_KEY must decode to 32 bytes"
    )
  }

  return key
}
