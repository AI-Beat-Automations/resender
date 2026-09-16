import { getSql } from "@/lib/db"
import type { PageChannel } from "@/lib/pages/page-registry"

import { isInvitationLive } from "./invitations"

// Repositorio del módulo Clientes (issue #154): `client_accounts` y lo que la
// lista de `/clientes` necesita leer de golpe. Las invitaciones tienen su
// propio módulo (`./invitations.ts`) y el borrado el suyo
// (`./client-deletion.ts`).
//
// Todas las lecturas y escrituras filtran por `tenant_id`: un padre no puede
// ver ni tocar los clientes de otro aunque adivine un id.

export type ClientAccountStatus = "pending" | "active"

export type ClientAccountRecord = {
  id: string
  tenantId: string
  /** Nulo hasta que el cliente acepta la invitación. */
  userId: string | null
  name: string
  maxConnections: number
  status: ClientAccountStatus
  createdAt: Date
  updatedAt: Date
}

type ClientAccountRow = {
  id: string
  tenant_id: string
  user_id: string | null
  name: string
  max_connections: number
  status: ClientAccountStatus
  created_at: Date
  updated_at: Date
}

// Estado de la última invitación, para que la lista sepa qué nota poner bajo
// «Pendiente»: `live` = todavía sirve; `cancelled` y `expired` explican por
// qué el cliente sigue pendiente sin enlace; `null` = nunca hubo (no debería
// pasar) o ya se aceptó.
export type ClientInvitationState = "live" | "cancelled" | "expired" | null

export type ClientConnectionSummary = {
  id: string
  channel: PageChannel
  metaPageId: string
  name: string
  username: string | null
}

export type ClientListItem = ClientAccountRecord & {
  /** Correo del user si ya aceptó; si no, el de la última invitación. */
  email: string | null
  invitation: ClientInvitationState
  /** Conexiones activas del cliente: son las que el diálogo de borrar lista. */
  connections: ClientConnectionSummary[]
}

type ClientListRow = ClientAccountRow & {
  email: string | null
  invitation_accepted_at: Date | null
  invitation_cancelled_at: Date | null
  invitation_expires_at: Date | null
}

type ClientConnectionRow = {
  id: string
  client_account_id: string
  channel: PageChannel
  meta_page_id: string
  name: string
  username: string | null
}

function mapClientAccount(row: ClientAccountRow): ClientAccountRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: row.name,
    maxConnections: row.max_connections,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Función pura: qué nota lleva la última invitación. */
export function invitationState(row: {
  invitation_accepted_at: Date | null
  invitation_cancelled_at: Date | null
  invitation_expires_at: Date | null
  now?: Date
}): ClientInvitationState {
  if (!row.invitation_expires_at) return null
  if (row.invitation_accepted_at) return null
  if (row.invitation_cancelled_at) return "cancelled"
  // La regla de «sirve» es una sola (`isInvitationLive`); acá solo se le pone
  // nombre a por qué no sirve.
  const live = isInvitationLive(
    {
      id: "",
      email: "",
      expiresAt: row.invitation_expires_at,
      acceptedAt: row.invitation_accepted_at,
      cancelledAt: row.invitation_cancelled_at,
    },
    row.now
  )
  return live ? "live" : "expired"
}

export async function listClientAccounts(
  tenantId: string
): Promise<ClientListItem[]> {
  const sql = getSql()

  // Dos consultas y no una con `json_agg`: la de conexiones es corta y así
  // el mapeo no depende de cómo el driver devuelva JSON anidado.
  const [accounts, connections] = await Promise.all([
    sql<ClientListRow[]>`
      select c.id, c.tenant_id, c.user_id, c.name, c.max_connections, c.status,
        c.created_at, c.updated_at,
        coalesce(u.email, i.email) as email,
        i.accepted_at as invitation_accepted_at,
        i.cancelled_at as invitation_cancelled_at,
        i.expires_at as invitation_expires_at
      from client_accounts c
      left join users u on u.id = c.user_id
      left join lateral (
        select email, accepted_at, cancelled_at, expires_at
        from client_invitations
        where client_account_id = c.id
        order by created_at desc
        limit 1
      ) i on true
      where c.tenant_id = ${tenantId}
      order by c.created_at asc
    `,
    sql<ClientConnectionRow[]>`
      select id, client_account_id, channel, meta_page_id, name, username
      from connected_pages
      where tenant_id = ${tenantId}
        and client_account_id is not null
        and status = 'active'
      order by connected_at asc
    `,
  ])

  const byClient = new Map<string, ClientConnectionSummary[]>()
  for (const row of connections) {
    const list = byClient.get(row.client_account_id) ?? []
    list.push({
      id: row.id,
      channel: row.channel,
      metaPageId: row.meta_page_id,
      name: row.name,
      username: row.username,
    })
    byClient.set(row.client_account_id, list)
  }

  return accounts.map((row) => ({
    ...mapClientAccount(row),
    email: row.email,
    invitation: invitationState(row),
    connections: byClient.get(row.id) ?? [],
  }))
}

export async function getClientAccount(
  tenantId: string,
  clientAccountId: string
): Promise<ClientAccountRecord | null> {
  const sql = getSql()
  const [row] = await sql<ClientAccountRow[]>`
    select id, tenant_id, user_id, name, max_connections, status,
      created_at, updated_at
    from client_accounts
    where id = ${clientAccountId} and tenant_id = ${tenantId}
    limit 1
  `
  return row ? mapClientAccount(row) : null
}

export async function createClientAccount(
  tenantId: string,
  input: { name: string; maxConnections: number }
): Promise<ClientAccountRecord> {
  const sql = getSql()
  const [row] = await sql<ClientAccountRow[]>`
    insert into client_accounts (tenant_id, name, max_connections)
    values (${tenantId}, ${input.name}, ${input.maxConnections})
    returning id, tenant_id, user_id, name, max_connections, status,
      created_at, updated_at
  `
  if (!row) throw new Error("client account insert returned no row")
  return mapClientAccount(row)
}

export async function updateClientMaxConnections(
  tenantId: string,
  clientAccountId: string,
  maxConnections: number
): Promise<ClientAccountRecord | null> {
  const sql = getSql()
  const [row] = await sql<ClientAccountRow[]>`
    update client_accounts
    set max_connections = ${maxConnections}, updated_at = now()
    where id = ${clientAccountId} and tenant_id = ${tenantId}
    returning id, tenant_id, user_id, name, max_connections, status,
      created_at, updated_at
  `
  return row ? mapClientAccount(row) : null
}

// «Ese correo ya está registrado»: tiene cuenta en `users` o una invitación
// viva en cualquier tenant. Lo segundo evita que dos padres inviten al mismo
// correo y el segundo enlace falle recién al aceptar. El correo llega ya
// normalizado (`normalizeEmail`), igual que como se guarda en `users`.
export async function isEmailTaken(email: string): Promise<boolean> {
  const sql = getSql()
  const rows = await sql<{ taken: boolean }[]>`
    select exists (
      select 1 from users where lower(email) = ${email}
      union all
      select 1 from client_invitations
      where lower(email) = ${email}
        and accepted_at is null
        and cancelled_at is null
        and expires_at > now()
    ) as taken
  `
  return rows[0]?.taken === true
}
