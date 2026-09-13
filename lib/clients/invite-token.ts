import { createHash, randomBytes } from "crypto"

// El [Enlace de invitación] de un cliente de agencia (ADR 0020).
//
// Es un secreto portador: quien tiene el enlace puede aceptar. Por eso se
// parece al [Enlace de recuperacion] y no al de verificación:
//   - En la base vive solo el sha256 del token, nunca el token.
//   - Sirve una sola vez y vence a los siete días.
//   - Viaja en la **query** (`/invite?token=…`) y nunca en el path: la
//     redacción de PostHog (`lib/posthog-redact.ts`) solo reescribe valores de
//     query, y un token en el path quedaría guardado en `$current_url`.
//
// Módulo puro, sin base ni Next, para que vitest lo cubra entero.

export const INVITE_TTL_DAYS = 7

/** 32 bytes del CSPRNG en base64url: 43 caracteres, sin padding. */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/**
 * Si un valor tiene forma de token. Es lo que separa un `?invite=` legítimo de
 * un open redirect: el login y el registro solo redirigen a `/invite` con un
 * valor que pasa por acá.
 */
export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && INVITE_TOKEN_PATTERN.test(value)
}

export function invitePath(token: string): string {
  return `/invite?token=${encodeURIComponent(token)}`
}

export function inviteExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
}
