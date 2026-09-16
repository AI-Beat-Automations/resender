import { setUserPassword } from "@/lib/auth/set-password"
import { getSql } from "@/lib/db"

import { ownerDisplayName } from "./client-owner"
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
} from "./invitation-token"

// Emisión, cancelación y aceptación de invitaciones (issue #154). La
// aceptación —peek del token, alta del user, enlace con
// `client_accounts.user_id`— es lo que consume `/invitacion/[token]`
// (ticket #156) y vive al final de este archivo.

export type IssuedInvitation = {
  id: string
  /** El token en claro, **solo** para armar el enlace del correo. */
  token: string
  email: string
  expiresAt: Date
}

// Emite una invitación nueva y deja fuera de servicio cualquier anterior que
// siguiera viva: reenviar es «token nuevo, el anterior deja de servir». La
// cancelación va primero para que nunca haya dos enlaces válidos a la vez,
// aunque el insert falle.
export async function issueInvitation(input: {
  clientAccountId: string
  email: string
  now?: Date
}): Promise<IssuedInvitation> {
  const sql = getSql()
  const now = input.now ?? new Date()
  const token = generateInvitationToken()
  const expiresAt = invitationExpiresAt(now)

  await cancelPendingInvitations(input.clientAccountId)

  const [row] = await sql<{ id: string }[]>`
    insert into client_invitations (client_account_id, email, token_hash, expires_at)
    values (
      ${input.clientAccountId},
      ${input.email},
      ${hashInvitationToken(token)},
      ${expiresAt.toISOString()}
    )
    returning id
  `
  if (!row) throw new Error("client invitation insert returned no row")

  return { id: row.id, token, email: input.email, expiresAt }
}

/** Marca como canceladas las invitaciones vivas del cliente. Devuelve cuántas. */
export async function cancelPendingInvitations(
  clientAccountId: string
): Promise<number> {
  const sql = getSql()
  const rows = await sql<{ id: string }[]>`
    update client_invitations
    set cancelled_at = now()
    where client_account_id = ${clientAccountId}
      and accepted_at is null
      and cancelled_at is null
    returning id
  `
  return rows.length
}

export type LatestInvitation = {
  id: string
  email: string
  expiresAt: Date
  acceptedAt: Date | null
  cancelledAt: Date | null
}

// La última invitación del cliente, viva o no: reenviar necesita su correo, y
// cancelar necesita saber si todavía sirve.
export async function getLatestInvitation(
  clientAccountId: string
): Promise<LatestInvitation | null> {
  const sql = getSql()
  const [row] = await sql<
    {
      id: string
      email: string
      expires_at: Date
      accepted_at: Date | null
      cancelled_at: Date | null
    }[]
  >`
    select id, email, expires_at, accepted_at, cancelled_at
    from client_invitations
    where client_account_id = ${clientAccountId}
    order by created_at desc
    limit 1
  `
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    cancelledAt: row.cancelled_at,
  }
}

/** Función pura: una invitación sirve si no se aceptó, no se canceló y no venció. */
export function isInvitationLive(
  invitation: LatestInvitation | null,
  now = new Date()
): boolean {
  if (!invitation) return false
  if (invitation.acceptedAt || invitation.cancelledAt) return false
  return new Date(invitation.expiresAt).getTime() > now.getTime()
}

// --- Aceptación (`/invitacion/[token]`, ticket #156) ---

export type InvitationState =
  "live" | "expired" | "cancelled" | "consumed" | "unknown"

type InvitationLookupRow = {
  id: string
  client_account_id: string
  email: string
  expires_at: Date
  accepted_at: Date | null
  cancelled_at: Date | null
  tenant_id: string
  client_name: string
  owner_name: string
  owner_email: string
}

/** Función pura: por qué un enlace sirve o no. El orden importa: aceptada
 * gana a cancelada, y las dos a vencida, para que la pantalla diga lo que
 * pasó y no lo que pasó después. */
export function classifyInvitation(
  row: InvitationLookupRow | null | undefined,
  now = new Date()
): InvitationState {
  if (!row) return "unknown"
  if (row.accepted_at) return "consumed"
  if (row.cancelled_at) return "cancelled"
  if (new Date(row.expires_at).getTime() <= now.getTime()) return "expired"
  return "live"
}

// Búsqueda por el hash, como `auth_api_keys`: el token en claro no toca la
// base, y la comparación la hace el índice único de `token_hash`.
async function findInvitationByToken(
  token: string
): Promise<InvitationLookupRow | undefined> {
  const sql = getSql()
  const [row] = await sql<InvitationLookupRow[]>`
    select i.id, i.client_account_id, i.email, i.expires_at, i.accepted_at,
      i.cancelled_at,
      c.tenant_id, c.name as client_name,
      u.name as owner_name, u.email as owner_email
    from client_invitations i
    join client_accounts c on c.id = i.client_account_id
    join users u on u.id = c.tenant_id
    where i.token_hash = ${hashInvitationToken(token)}
    limit 1
  `
  return row
}

export type InvitationPeek =
  | { state: "live"; clientName: string; email: string; ownerName: string }
  | { state: Exclude<InvitationState, "live"> }

// Lectura de cortesía **antes** del formulario, como `peekResetToken`: la
// mala noticia se da antes de que la persona piense y tipee dos contraseñas.
// No consume nada; la autoridad sobre el token es `acceptInvitation`.
export async function peekInvitation(
  token: string,
  now = new Date()
): Promise<InvitationPeek> {
  if (!token) return { state: "unknown" }

  const row = await findInvitationByToken(token)
  const state = classifyInvitation(row, now)
  if (state !== "live") return { state }
  if (!row) return { state: "unknown" }

  return {
    state: "live",
    clientName: row.client_name,
    email: row.email,
    ownerName: ownerDisplayName({
      name: row.owner_name,
      email: row.owner_email,
    }),
  }
}

export type AcceptInvitationResult =
  | {
      ok: true
      userId: string
      email: string
      tenantId: string
      clientAccountId: string
    }
  | { ok: false; reason: Exclude<InvitationState, "live"> | "email_taken" }

// Acepta la invitación: consume el token, da de alta al user con el correo ya
// verificado (el enlace probó el buzón, igual que el de recuperación), le fija
// la contraseña con el mismo primitivo que Ajustes y enlaza el cliente.
//
// El orden es deliberado y **no es atómico** (el driver HTTP no tiene
// transacciones interactivas): el token se consume **antes** del alta con un
// update condicional, así que dos aceptaciones simultáneas no crean dos users.
// Si el alta fallara después, la invitación queda gastada y el padre reenvía:
// es el lado seguro de la carrera. La contraseña la escribe `setUserPassword`
// y no la librería, porque `signUpEmail` mandaría el correo de verificación
// que acá no corresponde.
//
// **No abre sesión**: eso es del server action, que entra con
// `signInEmail` contra la credencial recién escrita.
export async function acceptInvitation(input: {
  token: string
  name: string
  password: string
  now?: Date
}): Promise<AcceptInvitationResult> {
  const sql = getSql()
  const now = input.now ?? new Date()

  const row = await findInvitationByToken(input.token)
  const state = classifyInvitation(row, now)
  if (state !== "live") return { ok: false, reason: state }
  if (!row) return { ok: false, reason: "unknown" }

  // Puede haber cambiado desde que el padre invitó (la persona se registró
  // por su cuenta): si se consumiera el token primero, quedaría gastado sin
  // haber creado nada.
  const taken = await sql<{ taken: boolean }[]>`
    select exists (
      select 1 from users where lower(email) = ${row.email}
    ) as taken
  `
  if (taken[0]?.taken === true) return { ok: false, reason: "email_taken" }

  const consumed = await sql<{ id: string }[]>`
    update client_invitations
    set accepted_at = now()
    where id = ${row.id}
      and accepted_at is null
      and cancelled_at is null
      and expires_at > now()
    returning id
  `
  if (consumed.length === 0) return { ok: false, reason: "consumed" }

  // `waitlisted` toma el default (`false` desde la 0024); el cliente igual no
  // pasa por ese gate: su acceso lo decide el actor y la suscripción del padre.
  const [user] = await sql<{ id: string }[]>`
    insert into users (email, name, email_verified)
    values (${row.email}, ${input.name}, ${true})
    returning id
  `
  if (!user) throw new Error("client user insert returned no row")

  await setUserPassword(user.id, input.password)

  await sql<{ id: string }[]>`
    update client_accounts
    set user_id = ${user.id}, status = 'active', updated_at = now()
    where id = ${row.client_account_id}
    returning id
  `

  return {
    ok: true,
    userId: user.id,
    email: row.email,
    tenantId: row.tenant_id,
    clientAccountId: row.client_account_id,
  }
}
