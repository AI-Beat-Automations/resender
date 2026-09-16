import { getSql } from "@/lib/db"

import type { ClientAccountStatus } from "./client-accounts"

// El actor de una request (issue #154, ticket 2): quién está detrás de la
// sesión y a qué tenant pertenece lo que ve. Para el padre `tenantId ===
// userId`, como siempre; para un cliente, `tenantId` es el del padre y
// `clientAccountId` es lo que distingue lo suyo (CONTEXT.md → [Tenant]).
//
// Se lee **vivo contra la base en cada request y nunca de la sesión**, con la
// misma doctrina que `waitlisted` (`lib/auth/waitlist.ts`): la cookie de caché
// vive cinco minutos, y un cliente eliminado seguiría viendo el inbox del
// padre hasta que venciera. Fail-closed: sin fila, sin actor.

export type Actor = {
  tenantId: string
  userId: string
  /** Nulo para el padre. */
  clientAccountId: string | null
}

export type ActorRow = {
  user_id: string
  client_account_id: string | null
  tenant_id: string | null
  client_status: ClientAccountStatus | null
}

// Tres respuestas y no dos, como `ProductAccess`: `unknown_user` es una sesión
// firmada contra un user que ya no está (solo se arregla autenticándose de
// nuevo) y `client_pending` es un user con fila de cliente que todavía no
// aceptó, un estado que el aceptar no deja en la práctica pero que no puede
// caer del lado abierto.
export type ActorResolution =
  | { kind: "actor"; actor: Actor }
  | { kind: "unknown_user" }
  | { kind: "client_pending" }

/** Función pura: la decisión a partir de la fila. */
export function decideActor(row: ActorRow | null | undefined): ActorResolution {
  if (!row) return { kind: "unknown_user" }

  if (row.client_account_id === null || row.tenant_id === null) {
    return {
      kind: "actor",
      actor: {
        tenantId: row.user_id,
        userId: row.user_id,
        clientAccountId: null,
      },
    }
  }

  if (row.client_status !== "active") return { kind: "client_pending" }

  return {
    kind: "actor",
    actor: {
      tenantId: row.tenant_id,
      userId: row.user_id,
      clientAccountId: row.client_account_id,
    },
  }
}

export function isClientActor(actor: Actor): boolean {
  return actor.clientAccountId !== null
}

export async function resolveActorByUserId(
  userId: string
): Promise<ActorResolution> {
  const sql = getSql()
  // `client_accounts.user_id` es `unique`: a lo sumo una fila por user.
  const [row] = await sql<ActorRow[]>`
    select u.id as user_id,
      c.id as client_account_id,
      c.tenant_id,
      c.status as client_status
    from users u
    left join client_accounts c on c.user_id = u.id
    where u.id = ${userId}
    limit 1
  `
  return decideActor(row)
}

export async function resolveActor(session: {
  user: { id: string }
}): Promise<ActorResolution> {
  return resolveActorByUserId(session.user.id)
}
