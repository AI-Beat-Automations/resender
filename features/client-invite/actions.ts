"use server"

import { redirect } from "next/navigation"

import { getSession } from "@/lib/auth/session"
import { allowAuthAttempt } from "@/lib/auth/rate-limit"
import { acceptAgencyClientInvitation } from "@/lib/clients/client-repository"
import { hashInviteToken, isInviteToken } from "@/lib/clients/invite-token"
import { getDictionary } from "@/content/i18n"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { log } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

// Aceptar un [Enlace de invitación] (ADR 0020). La hace la persona invitada y
// no el dueño: lo que autoriza es el token, no un rol.

export type AcceptInviteState = { error?: string }

export async function acceptInvitationAction(
  _state: AcceptInviteState,
  formData: FormData
): Promise<AcceptInviteState> {
  const { lang, t } = await getAppI18n()

  // El mismo límite por IP que el acceso y el alta: el token es una
  // credencial, y probar tokens a mano no puede salir gratis.
  if (!(await allowAuthAttempt())) {
    return { error: getDictionary(lang).auth.errors.tooManyAttempts }
  }

  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  const token = formData.get("token")
  if (!isInviteToken(token)) return { error: t.invite.acceptFailed }

  const accepted = await acceptAgencyClientInvitation(
    session.user.id,
    hashInviteToken(token)
  )
  if (!accepted.ok) {
    return {
      error:
        accepted.reason === "client_has_member"
          ? t.invite.clientHasMember
          : t.invite.acceptFailed,
    }
  }

  log({
    entrypoint: "action",
    action: "agency_client_accept",
    outcome: "ok",
    // La persona todavía no tiene tenant propio que registrar: el id que se
    // puede citar en soporte es el suyo.
    tenantId: session.user.id,
  })

  if (posthog) {
    posthog.capture({
      distinctId: session.user.id,
      event: "agency client invitation accepted",
      properties: { agency_client_id: accepted.clientId },
    })
    await posthog.flush()
  }

  // Fuera de cualquier `try`: `redirect()` funciona lanzando.
  redirect("/connections")
}
