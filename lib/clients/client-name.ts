// Nombre de un cliente de agencia. La base lo exige con un check
// (`length(btrim(name)) between 1 and 80`); esto es la misma regla en código,
// para contestar con un mensaje antes de que la base lo rechace.

export const CLIENT_NAME_MAX_LENGTH = 80

export type ClientNameResult =
  | { ok: true; value: string }
  | { ok: false; error: "name_required" | "name_too_long" }

export function normalizeClientName(input: unknown): ClientNameResult {
  const value = typeof input === "string" ? input.trim() : ""
  if (!value) return { ok: false, error: "name_required" }
  if ([...value].length > CLIENT_NAME_MAX_LENGTH) {
    return { ok: false, error: "name_too_long" }
  }
  return { ok: true, value }
}

export type InviteEmailResult =
  { ok: true; value: string | null } | { ok: false; error: "invalid_email" }

/** El correo opcional de una invitación: vacío es "cualquiera con el enlace". */
export function normalizeInviteEmail(input: unknown): InviteEmailResult {
  const value = typeof input === "string" ? input.trim().toLowerCase() : ""
  if (!value) return { ok: true, value: null }
  // Forma mínima: la prueba real es que el correo coincida con la cuenta que
  // acepta, no que este regex sea perfecto.
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { ok: false, error: "invalid_email" }
  }
  return { ok: true, value }
}
