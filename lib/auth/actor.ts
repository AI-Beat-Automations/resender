import { getSql } from "@/lib/db"
import { getSession } from "@/lib/auth/session"

// Quién está operando y sobre qué tenant (ADR 0020).
//
// Hasta el modo agencia `tenantId = session.user.id` y no hacía falta nada más.
// Ahora hay dos formas de persona:
//   - `owner`: la cuenta de siempre. Su `userId` ES el tenant.
//   - `client`: la persona de un [Cliente de agencia]. Tiene su propia fila de
//     `users` para autenticarse, pero opera en el tenant de la agencia y solo
//     sobre las conexiones asignadas a su cliente.
//
// **Se lee vivo contra la base en cada request y nunca viaja en la sesión** —la
// misma doctrina que el gate de acceso—: la cookie cache de Better Auth dura
// cinco minutos, y revocar el acceso de alguien tiene que pegar en la siguiente
// request, no cinco minutos después.

export type Actor =
  | { kind: "owner"; userId: string; tenantId: string }
  | {
      kind: "client"
      userId: string
      tenantId: string
      clientId: string
      clientName: string
    }

export type ActorResolution =
  | { status: "ok"; actor: Actor }
  /** Sesión firmada que apunta a un usuario que no está en la base. */
  | { status: "unknown_user" }
  /** La propia persona tiene el gate de acceso cerrado. */
  | { status: "waitlisted" }
  /**
   * La persona es de un cliente de agencia, pero la agencia no está: se borró
   * el cliente o el tenant a mitad de camino, o el tenant tiene el gate de
   * acceso cerrado.
   */
  | { status: "agency_unavailable" }

export type ActorRow = {
  user_id: string
  waitlisted: boolean | null
  agency_client_id: string | null
  member_tenant_id: string | null
  client_name: string | null
  tenant_waitlisted: boolean | null
}

/**
 * Fail-closed: cualquier dato que no se pueda leer como "sí" cae del lado de no
 * entrar. Una membresía a medias —cliente o tenant ausente— no degrada a
 * `owner`: esa persona nunca tuvo tenant propio.
 */
export function decideActor(row: ActorRow | null | undefined): ActorResolution {
  if (!row) return { status: "unknown_user" }
  if (row.waitlisted !== false) return { status: "waitlisted" }

  if (row.agency_client_id === null && row.member_tenant_id === null) {
    return {
      status: "ok",
      actor: { kind: "owner", userId: row.user_id, tenantId: row.user_id },
    }
  }

  if (
    !row.agency_client_id ||
    !row.member_tenant_id ||
    row.client_name === null ||
    row.tenant_waitlisted !== false
  ) {
    return { status: "agency_unavailable" }
  }

  return {
    status: "ok",
    actor: {
      kind: "client",
      userId: row.user_id,
      tenantId: row.member_tenant_id,
      clientId: row.agency_client_id,
      clientName: row.client_name,
    },
  }
}

export async function resolveActor(userId: string): Promise<ActorResolution> {
  const sql = getSql()
  const [row] = await sql<ActorRow[]>`
    select
      u.id as user_id,
      u.waitlisted,
      m.agency_client_id,
      m.tenant_id as member_tenant_id,
      c.name as client_name,
      t.waitlisted as tenant_waitlisted
    from users u
    left join agency_client_members m on m.user_id = u.id
    left join agency_clients c
      on c.id = m.agency_client_id and c.tenant_id = m.tenant_id
    left join users t on t.id = m.tenant_id
    where u.id = ${userId}
    limit 1
  `

  return decideActor(row)
}

/** Sesión + actor. `null` es "no hay sesión". */
export async function getActor(): Promise<ActorResolution | null> {
  const session = await getSession()
  if (!session?.user?.id) return null
  return resolveActor(session.user.id)
}

export function isOwner(
  actor: Actor
): actor is Extract<Actor, { kind: "owner" }> {
  return actor.kind === "owner"
}

export type ActorGate =
  | { ok: true; actor: Actor }
  | { ok: false; denial: "not_signed_in" | "waitlisted" | "agency_unavailable" }

/**
 * Para server actions y rutas: se pueden invocar por POST directo sin pasar por
 * el layout, así que cada una resuelve el actor por su cuenta.
 */
export async function requireActor(): Promise<ActorGate> {
  const resolution = await getActor()
  if (!resolution || resolution.status === "unknown_user") {
    return { ok: false, denial: "not_signed_in" }
  }
  if (resolution.status !== "ok") {
    return { ok: false, denial: resolution.status }
  }
  return { ok: true, actor: resolution.actor }
}

/** El mensaje de una denegación de `requireActor`, en el idioma de la acción. */
export function describeActorDenial(
  denial: Extract<ActorGate, { ok: false }>["denial"],
  t: { notSignedIn: string; waitlisted: string; agencyUnavailable: string }
): string {
  if (denial === "not_signed_in") return t.notSignedIn
  if (denial === "waitlisted") return t.waitlisted
  return t.agencyUnavailable
}
