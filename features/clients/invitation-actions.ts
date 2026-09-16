"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { APIError } from "better-auth/api"

import { getAuth } from "@/lib/auth/auth"
import { allowAuthAttempt } from "@/lib/auth/rate-limit"
import {
  validateNameInput,
  validatePasswordChangeInput,
  AUTH_INPUT_KEY,
} from "@/lib/auth/validation"
import {
  acceptInvitation,
  type AcceptInvitationResult,
} from "@/lib/clients/invitations"
import { getAppDict } from "@/lib/i18n/app-dict"
import { describeError, log, type LogReason } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

// Aceptar la [Invitacion de cliente] desde `/invitacion/[token]` (issue #154,
// ticket #156). Va aparte de `features/clients/actions.ts` porque es la única
// acción del módulo **sin sesión**: quien la llama todavía no existe como
// user. El molde es `resetPasswordAction`: límite por IP primero, validación
// con las reglas de siempre, el token en un input oculto, y el redirect fuera
// del `try`.

export type AcceptInvitationState = {
  error?: string
}

type AcceptFailure = Extract<AcceptInvitationResult, { ok: false }>["reason"]

const ACCEPT_FAILURE_KEY: Record<
  AcceptFailure,
  | "invitationExpired"
  | "invitationCancelled"
  | "invitationConsumed"
  | "invitationUnknown"
  | "invitationEmailTaken"
> = {
  expired: "invitationExpired",
  cancelled: "invitationCancelled",
  consumed: "invitationConsumed",
  unknown: "invitationUnknown",
  email_taken: "invitationEmailTaken",
}

const ACCEPT_FAILURE_REASON: Record<AcceptFailure, LogReason> = {
  expired: "invitation_expired",
  cancelled: "invitation_cancelled",
  consumed: "invitation_consumed",
  unknown: "invitation_not_found",
  email_taken: "email_taken",
}

export async function acceptInvitationAction(
  _state: AcceptInvitationState,
  formData: FormData
): Promise<AcceptInvitationState> {
  const t = await getAppDict()

  // Antes de validar y antes de tocar la base, como el acceso y el alta: lo
  // que encarece adivinar tokens es que el intento 11 no cueste nada.
  if (!(await allowAuthAttempt())) return { error: t.actions.tooManyAttempts }

  const token = formData.get("token")
  if (typeof token !== "string" || !token) {
    return { error: t.actions.invitationUnknown }
  }

  const name = validateNameInput(formData.get("name"))
  if (!name.ok) return { error: t.actions.invitationNameRequired }

  // Las mismas reglas que el alta y el cambio de contraseña, y el único sitio
  // que compara las dos: la aceptación recibe una sola.
  const input = validatePasswordChangeInput(
    formData.get("password"),
    formData.get("confirmPassword")
  )
  if (!input.ok) return { error: t.actions[AUTH_INPUT_KEY[input.error]] }

  const result = await acceptInvitation({
    token,
    name: name.value,
    password: input.value.password,
  })

  if (!result.ok) {
    log({
      entrypoint: "action",
      action: "client_invite_accept",
      outcome: "failed",
      reason: ACCEPT_FAILURE_REASON[result.reason],
    })
    return { error: t.actions[ACCEPT_FAILURE_KEY[result.reason]] }
  }

  log({
    entrypoint: "action",
    action: "client_invite_accept",
    outcome: "ok",
    tenantId: result.tenantId,
    clientAccountId: result.clientAccountId,
  })

  if (posthog) {
    posthog.identify({
      distinctId: result.userId,
      properties: { $set: { email: result.email } },
    })
    posthog.capture({
      distinctId: result.userId,
      event: "client accepted invitation",
      properties: {
        tenant_id: result.tenantId,
        client_account_id: result.clientAccountId,
      },
    })
    await posthog.flush()
  }

  // La sesión se abre con el login normal contra la credencial recién
  // escrita: ninguna vía especial, y de paso prueba que la contraseña quedó
  // bien. `headers` es por donde `nextCookies()` escribe la cookie.
  try {
    await getAuth().api.signInEmail({
      body: {
        email: result.email,
        password: input.value.password,
        rememberMe: true,
      },
      headers: await headers(),
    })
  } catch (error) {
    if (!(error instanceof APIError)) throw error
    // El acceso existe aunque la sesión no haya abierto: la persona entra por
    // `/login`. Se registra porque es un fallo nuestro, no suyo.
    log({
      entrypoint: "action",
      action: "client_invite_accept",
      outcome: "failed",
      reason: "internal_error",
      tenantId: result.tenantId,
      clientAccountId: result.clientAccountId,
      errorMessage: describeError(error),
    })
    return { error: t.actions.invitationSignInFailed }
  }

  // Fuera del `try`: `redirect()` funciona lanzando y el catch lo tragaría.
  // El destino es Conexiones: el layout de `(product)` resuelve el actor y
  // dibuja la consola reducida.
  redirect("/connections")
}
