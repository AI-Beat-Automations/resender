import { createHash, randomBytes } from "crypto"

// El token de la invitación (issue #154). Viaja solo en el correo; en la base
// vive su hash SHA-256, con el mismo criterio que `auth_api_keys`: una fuga de
// la tabla no sirve para aceptar nada. La comparación en tiempo constante al
// aceptar llega con `/invitacion/[token]` (ticket 2).

const TOKEN_BYTES = 32

// Siete días, la promesa del correo y de la pantalla de vencido.
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url")
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function invitationExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS)
}
