import { getSql } from "@/lib/db"

import {
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
} from "./invitation-token"

// Emisión y cancelación de invitaciones (issue #154). La aceptación —peek del
// token, alta del user, enlace con `client_accounts.user_id`— llega con
// `/invitacion/[token]` en el ticket 2 y vive acá también cuando exista.

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
