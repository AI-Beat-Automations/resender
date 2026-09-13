import { getSql } from "@/lib/db"

import { inviteExpiresAt } from "./invite-token"

// Clientes de agencia, sus personas y sus invitaciones (ADR 0020).
//
// Todo lo que escribe acá lo pide el **dueño** del tenant y cada consulta lleva
// `tenant_id` en el `where`: las acciones verifican el rol, y este módulo se
// asegura de que un id de otro tenant no toque nada. Las foreign keys
// compuestas de la migración 0025 son la tercera línea.
//
// La excepción es aceptar una invitación, que la hace la persona invitada: ahí
// lo que autoriza es el hash del token, no el tenant.

export type AgencyClientSummary = {
  id: string
  name: string
  createdAt: Date
  /** La persona que entra a este cliente, si ya aceptó. */
  member: { userId: string; email: string; since: Date } | null
  /** La invitación vigente, si hay una y todavía nadie aceptó. */
  pendingInvitation: { email: string | null; expiresAt: Date } | null
}

type AgencyClientRow = {
  id: string
  name: string
  created_at: Date
  member_user_id: string | null
  member_email: string | null
  member_since: Date | null
  invitation_email: string | null
  invitation_expires_at: Date | null
}

export async function listAgencyClients(
  tenantId: string
): Promise<AgencyClientSummary[]> {
  const sql = getSql()
  const rows = await sql<AgencyClientRow[]>`
    select
      c.id,
      c.name,
      c.created_at,
      m.user_id as member_user_id,
      u.email as member_email,
      m.created_at as member_since,
      inv.email as invitation_email,
      inv.expires_at as invitation_expires_at
    from agency_clients c
    left join agency_client_members m
      on m.agency_client_id = c.id and m.tenant_id = c.tenant_id
    left join users u on u.id = m.user_id
    left join lateral (
      select i.email, i.expires_at
      from agency_client_invitations i
      where i.agency_client_id = c.id
        and i.tenant_id = c.tenant_id
        and i.accepted_at is null
        and i.revoked_at is null
        and i.expires_at > now()
      order by i.created_at desc
      limit 1
    ) inv on true
    where c.tenant_id = ${tenantId}
    order by c.created_at asc
  `

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    member:
      row.member_user_id && row.member_email && row.member_since
        ? {
            userId: row.member_user_id,
            email: row.member_email,
            since: row.member_since,
          }
        : null,
    pendingInvitation:
      !row.member_user_id && row.invitation_expires_at
        ? {
            email: row.invitation_email,
            expiresAt: row.invitation_expires_at,
          }
        : null,
  }))
}

export async function createAgencyClient(
  tenantId: string,
  name: string
): Promise<{ id: string; name: string }> {
  const sql = getSql()
  const [row] = await sql<{ id: string; name: string }[]>`
    insert into agency_clients (tenant_id, name)
    values (${tenantId}, ${name})
    returning id, name
  `
  if (!row) throw new Error("agency client insert returned no row")
  return row
}

export async function renameAgencyClient(
  tenantId: string,
  clientId: string,
  name: string
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    update agency_clients
    set name = ${name}, updated_at = now()
    where id = ${clientId} and tenant_id = ${tenantId}
    returning id
  `
  return rows.length > 0
}

/**
 * Quita el acceso de la persona de un cliente **borrando su usuario**: la fila
 * solo existía para entrar a ese cliente (ADR 0020). La cascada se lleva la
 * membresía, sus sesiones, sus credenciales y su token de Meta, y como el
 * actor se lee vivo en cada request, queda afuera en la siguiente aunque su
 * cookie de sesión siga en caché.
 *
 * Devuelve cuántas personas se borraron (0 o 1 en v1).
 */
export async function revokeAgencyClientAccess(
  tenantId: string,
  clientId: string
): Promise<number> {
  const sql = getSql()
  const rows = await sql`
    delete from users
    where id in (
      select user_id from agency_client_members
      where agency_client_id = ${clientId} and tenant_id = ${tenantId}
    )
    returning id
  `
  return rows.length
}

/**
 * Borra el cliente: primero su persona, después el cliente. Sus conexiones
 * vuelven a "sin asignar" por el `on delete set null` de la 0025, con todo su
 * historial. Las dos sentencias van en un batch atómico.
 */
export async function deleteAgencyClient(
  tenantId: string,
  clientId: string
): Promise<boolean> {
  const sql = getSql()
  const [, deleted] = await sql.transaction([
    sql`
      delete from users
      where id in (
        select user_id from agency_client_members
        where agency_client_id = ${clientId} and tenant_id = ${tenantId}
      )
    `,
    sql`
      delete from agency_clients
      where id = ${clientId} and tenant_id = ${tenantId}
      returning id
    `,
  ])
  return Array.isArray(deleted) && deleted.length > 0
}

export type CreateInvitationResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: "client_not_found" | "client_has_member" }

/**
 * Deja una invitación vigente para el cliente y revoca la anterior, en un solo
 * batch: nunca hay dos enlaces válidos para el mismo cliente.
 *
 * Recibe el **hash**: el token en claro lo genera y lo muestra la acción, y
 * este módulo nunca lo ve.
 */
export async function createAgencyClientInvitation(input: {
  tenantId: string
  clientId: string
  tokenHash: string
  email: string | null
  now?: Date
}): Promise<CreateInvitationResult> {
  const sql = getSql()
  const expiresAt = inviteExpiresAt(input.now)

  const [client] = await sql<{ has_member: boolean }[]>`
    select exists (
      select 1 from agency_client_members m
      where m.agency_client_id = c.id and m.tenant_id = c.tenant_id
    ) as has_member
    from agency_clients c
    where c.id = ${input.clientId} and c.tenant_id = ${input.tenantId}
    limit 1
  `
  if (!client) return { ok: false, reason: "client_not_found" }
  if (client.has_member) return { ok: false, reason: "client_has_member" }

  const [, inserted] = await sql.transaction([
    sql`
      update agency_client_invitations
      set revoked_at = now()
      where agency_client_id = ${input.clientId}
        and tenant_id = ${input.tenantId}
        and accepted_at is null
        and revoked_at is null
    `,
    // El `where not exists` repite la comprobación de la persona dentro del
    // batch: si alguien aceptó entre la lectura y esta escritura, no queda un
    // enlace nuevo colgando de un cliente que ya tiene persona.
    sql`
      insert into agency_client_invitations (
        tenant_id, agency_client_id, token_hash, email, expires_at
      )
      select ${input.tenantId}, c.id, ${input.tokenHash}, ${input.email},
        ${expiresAt}
      from agency_clients c
      where c.id = ${input.clientId} and c.tenant_id = ${input.tenantId}
        and not exists (
          select 1 from agency_client_members m
          where m.agency_client_id = c.id
        )
      returning id
    `,
  ])

  if (!Array.isArray(inserted) || inserted.length === 0) {
    return { ok: false, reason: "client_has_member" }
  }
  return { ok: true, expiresAt }
}

/** Anula la invitación vigente sin generar otra. */
export async function cancelAgencyClientInvitation(
  tenantId: string,
  clientId: string
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    update agency_client_invitations
    set revoked_at = now()
    where agency_client_id = ${clientId}
      and tenant_id = ${tenantId}
      and accepted_at is null
      and revoked_at is null
    returning id
  `
  return rows.length > 0
}

export type InvitationPreview = {
  clientName: string
  agencyName: string
  /** Si la invitación está atada a un correo. El correo no se muestra. */
  boundToEmail: boolean
}

/**
 * Lo que `/invite` necesita para decir "X te dio acceso a Y". `null` para un
 * enlace que no sirve —no existe, venció, ya se usó, se canceló o el cliente
 * ya tiene persona—: la pantalla dice lo mismo en todos los casos.
 */
export async function findInvitationPreview(
  tokenHash: string
): Promise<InvitationPreview | null> {
  const sql = getSql()
  const [row] = await sql<
    { client_name: string; agency_name: string; email: string | null }[]
  >`
    select
      c.name as client_name,
      coalesce(nullif(btrim(t.name), ''), t.email) as agency_name,
      i.email
    from agency_client_invitations i
    join agency_clients c
      on c.id = i.agency_client_id and c.tenant_id = i.tenant_id
    join users t on t.id = i.tenant_id
    where i.token_hash = ${tokenHash}
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
      and not exists (
        select 1 from agency_client_members m
        where m.agency_client_id = i.agency_client_id
      )
    limit 1
  `

  if (!row) return null
  return {
    clientName: row.client_name,
    agencyName: row.agency_name,
    boundToEmail: row.email !== null,
  }
}

export type InvitationIneligibility =
  "own_account" | "already_member" | "email_mismatch" | "has_own_data"

/**
 * Por qué una cuenta con sesión no puede aceptar. Solo lectura y solo para
 * explicarlo en pantalla: la decisión autoritativa es la sentencia de
 * `acceptAgencyClientInvitation`, que vuelve a comprobar todo al escribir.
 *
 * Una persona es **o dueña de su cuenta o miembro de un solo cliente**: una
 * cuenta que ya tiene suscripción, conexiones, clientes o API keys propias no
 * puede pasar a operar en otro tenant sin dejar esos datos huérfanos.
 */
export async function diagnoseInvitationEligibility(
  userId: string,
  tokenHash: string
): Promise<InvitationIneligibility | null> {
  const sql = getSql()
  const [row] = await sql<
    {
      own_account: boolean
      already_member: boolean
      email_mismatch: boolean
      has_own_data: boolean
    }[]
  >`
    select
      i.tenant_id = u.id as own_account,
      exists (
        select 1 from agency_client_members m where m.user_id = u.id
      ) as already_member,
      (i.email is not null and lower(i.email) <> lower(u.email)) as email_mismatch,
      (
        exists (select 1 from subscriptions s where s.tenant_id = u.id)
        or exists (select 1 from connected_pages p where p.tenant_id = u.id)
        or exists (select 1 from agency_clients c where c.tenant_id = u.id)
        or exists (select 1 from auth_api_keys k where k.user_id = u.id)
      ) as has_own_data
    from agency_client_invitations i
    cross join users u
    where i.token_hash = ${tokenHash} and u.id = ${userId}
    limit 1
  `

  if (!row) return null
  if (row.own_account) return "own_account"
  if (row.already_member) return "already_member"
  if (row.email_mismatch) return "email_mismatch"
  if (row.has_own_data) return "has_own_data"
  return null
}

/** El cliente al que ya pertenece una persona, si pertenece a alguno. */
export async function findMembershipByInvitation(
  userId: string,
  tokenHash: string
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    select 1
    from agency_client_members m
    join agency_client_invitations i
      on i.agency_client_id = m.agency_client_id
    where m.user_id = ${userId}
      and i.token_hash = ${tokenHash}
      and i.accepted_by_user_id = ${userId}
    limit 1
  `
  return rows.length > 0
}

export type AcceptInvitationResult =
  | { ok: true; clientId: string }
  | { ok: false; reason: "invalid_or_ineligible" | "client_has_member" }

/**
 * Acepta la invitación en **una sola sentencia**: consumir el enlace y crear la
 * membresía no se pueden separar, y el driver HTTP de Neon no tiene
 * transacciones interactivas. Todas las condiciones van en el `where` del
 * `update`; si alguna falla, no se consume nada y no se inserta nada.
 */
export async function acceptAgencyClientInvitation(
  userId: string,
  tokenHash: string
): Promise<AcceptInvitationResult> {
  const sql = getSql()
  try {
    const [row] = await sql<{ agency_client_id: string }[]>`
      with inv as (
        update agency_client_invitations i
        set accepted_at = now(), accepted_by_user_id = ${userId}
        where i.token_hash = ${tokenHash}
          and i.accepted_at is null
          and i.revoked_at is null
          and i.expires_at > now()
          and i.tenant_id <> ${userId}
          and (
            i.email is null
            or lower(i.email) = (select lower(email) from users where id = ${userId})
          )
          and not exists (
            select 1 from agency_client_members m
            where m.agency_client_id = i.agency_client_id
          )
          and not exists (select 1 from subscriptions where tenant_id = ${userId})
          and not exists (select 1 from connected_pages where tenant_id = ${userId})
          and not exists (select 1 from agency_clients where tenant_id = ${userId})
          and not exists (select 1 from auth_api_keys where user_id = ${userId})
          and not exists (
            select 1 from agency_client_members where user_id = ${userId}
          )
        returning i.agency_client_id, i.tenant_id
      )
      insert into agency_client_members (user_id, agency_client_id, tenant_id)
      select ${userId}, agency_client_id, tenant_id from inv
      returning agency_client_id
    `

    if (!row) return { ok: false, reason: "invalid_or_ineligible" }
    return { ok: true, clientId: row.agency_client_id }
  } catch (error) {
    // 23505: otra persona aceptó otra invitación del mismo cliente en la misma
    // ventana y ganó el índice único. La sentencia entera se revierte, así que
    // este enlace tampoco se consumió.
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "client_has_member" }
    }
    throw error
  }
}

/**
 * Asigna una conexión a un cliente, o la deja sin asignar con `null`. La FK
 * compuesta rechaza un cliente de otro tenant (23503), que se contesta igual
 * que "no existe".
 */
export async function assignConnectionToClient(input: {
  tenantId: string
  connectionId: string
  clientId: string | null
}): Promise<boolean> {
  const sql = getSql()
  try {
    const rows = await sql`
      update connected_pages
      set agency_client_id = ${input.clientId}::uuid, updated_at = now()
      where id = ${input.connectionId} and tenant_id = ${input.tenantId}
      returning id
    `
    return rows.length > 0
  } catch (error) {
    if (isForeignKeyViolation(error)) return false
    throw error
  }
}

function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

function isUniqueViolation(error: unknown) {
  return pgCode(error) === "23505"
}

function isForeignKeyViolation(error: unknown) {
  return pgCode(error) === "23503"
}
