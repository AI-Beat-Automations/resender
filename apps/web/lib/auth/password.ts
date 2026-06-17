import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto"
import { promisify } from "util"

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64
const FORMAT = "scrypt"

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url")
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  return `${FORMAT}$${salt}$${derived.toString("base64url")}`
}

export async function verifyPassword(password: string, storedHash: string) {
  const [format, salt, hash] = storedHash.split("$")
  if (format !== FORMAT || !salt || !hash) return false

  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  const expected = Buffer.from(hash, "base64url")

  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
