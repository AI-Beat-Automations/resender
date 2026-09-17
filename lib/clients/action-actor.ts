import { getSession } from "@/lib/auth/session"
import type { AppDict } from "@/content/i18n/app"

import { resolveActorByUserId, type Actor } from "./actor"

// Quién actúa y sobre qué tenant, para las server actions (issue #154). Se lee
// vivo de la base, nunca de la sesión: un cliente actúa sobre el tenant del
// padre y solo sobre **sus** filas (`clientAccountId`), y el padre sobre
// todas. Lo comparten Conexiones e Inbox; sin actor la acción responde «no has
// iniciado sesión», que es lo que ve un user sin fila o con cliente pendiente.
export type ActionActor =
  | { ok: true; actor: Actor }
  | { ok: false; error: string }

export async function resolveActionActor(t: AppDict): Promise<ActionActor> {
  const session = await getSession()
  if (!session?.user?.id) return { ok: false, error: t.actions.notSignedIn }
  const resolution = await resolveActorByUserId(session.user.id)
  if (resolution.kind !== "actor") {
    return { ok: false, error: t.actions.notSignedIn }
  }
  return { ok: true, actor: resolution.actor }
}
