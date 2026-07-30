import { ContractError } from "@workspace/contracts"
import { z } from "zod"

export type CursorValue = {
  at: string
  id: string
}

export function encodeCursor(value: CursorValue): string {
  return base64UrlEncode(JSON.stringify(value))
}

export function decodeCursor(value: string | undefined): CursorValue | null {
  if (!value) return null

  try {
    const decoded = JSON.parse(base64UrlDecode(value)) as {
      at?: unknown
      id?: unknown
    }
    if (
      typeof decoded.at !== "string" ||
      Number.isNaN(Date.parse(decoded.at)) ||
      typeof decoded.id !== "string" ||
      !z.uuid().safeParse(decoded.id).success
    ) {
      throw new Error("invalid cursor payload")
    }
    return { at: decoded.at, id: decoded.id }
  } catch {
    throw new ContractError({
      code: "validation_error",
      message: "The cursor is invalid.",
      status: 400,
      details: [{ path: "cursor", message: "Invalid cursor" }],
    })
  }
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}

function base64UrlDecode(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  )
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
