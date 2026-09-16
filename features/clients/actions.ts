"use server"

import { revalidatePath } from "next/cache"

import { fmt } from "@/content/i18n/app/format"
import { resolveEmailLocale } from "@/lib/auth/email-locale"
import { getSession, type AppSession } from "@/lib/auth/session"
import {
  EMAIL_RE,
  normalizeEmail,
  validateNameInput,
} from "@/lib/auth/validation"
import {
  createClientAccount,
  getClientAccount,
  isEmailTaken,
  updateClientMaxConnections,
} from "@/lib/clients/client-accounts"
import {
  deleteClientRows,
  deleteClientWithConnections,
} from "@/lib/clients/client-deletion"
import { ownerDisplayName } from "@/lib/clients/client-owner"
import { resolveClientPlan, type ClientPlan } from "@/lib/clients/client-plan"
import { validateMaxConnections } from "@/lib/clients/client-rules"
import {
  cancelPendingInvitations,
  getLatestInvitation,
  issueInvitation,
} from "@/lib/clients/invitations"
import { sendClientInvitationEmail } from "@/lib/email/client-invitation-email"
import { getAppDict } from "@/lib/i18n/app-dict"
import { log, type LogAction } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

// Server actions del módulo Clientes (issue #154, ticket #155): lo que el
// padre hace desde `/clientes`. Mismo molde que `features/connections`: la
// sesión y el diccionario primero, los códigos del dominio se traducen acá.

export type ClientActionState = {
  error?: string
  message?: string
}

const CLIENTS_PATH = "/clientes"

// El enlace que viaja en el correo. Sale de `BETTER_AUTH_URL` y no de
// `APP_URL`, por el mismo motivo que el de recuperación de contraseña
// (`lib/auth/auth.ts`): `APP_URL` en dev apunta al túnel de Meta.
function invitationUrl(token: string): string | null {
  const base = process.env.BETTER_AUTH_URL
  if (!base) return null
  return `${base}/invitacion/${encodeURIComponent(token)}`
}

// Emite la invitación y manda el correo. Devuelve si el correo salió: el
// cliente ya existe aunque el envío falle, y la UI ofrece reenviar.
async function inviteClient(input: {
  session: AppSession
  clientAccountId: string
  clientName: string
  email: string
}): Promise<boolean> {
  const issued = await issueInvitation({
    clientAccountId: input.clientAccountId,
    email: input.email,
  })

  const inviteUrl = invitationUrl(issued.token)
  if (!inviteUrl) {
    log({
      entrypoint: "action",
      action: "email_send",
      outcome: "failed",
      reason: "not_configured",
      tenantId: input.session.user.id,
      clientAccountId: input.clientAccountId,
      errorMessage: "BETTER_AUTH_URL is not set: no origin for the invite link",
    })
    return false
  }

  const result = await sendClientInvitationEmail({
    to: input.email,
    locale: await resolveEmailLocale(),
    clientName: input.clientName,
    ownerName: ownerDisplayName(input.session.user),
    inviteUrl,
  })
  if (!result.ok) {
    log({
      entrypoint: "action",
      action: "email_send",
      outcome: "failed",
      reason: result.reason ?? "internal_error",
      status: result.status,
      tenantId: input.session.user.id,
      clientAccountId: input.clientAccountId,
      errorMessage: result.error ?? undefined,
    })
  }
  return result.ok
}

export async function createClientAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }
  const tenantId = session.user.id

  const plan = await resolveClientPlan(tenantId)
  if (!plan.canManage || plan.maxPages === null) {
    log({
      entrypoint: "action",
      action: "client_create",
      outcome: "failed",
      reason: "plan_not_allowed",
      tenantId,
    })
    return { error: t.actions.clientsPlanNotAllowed }
  }

  const name = validateNameInput(formData.get("name"))
  if (!name.ok) return { error: t.actions.clientNameRequired }

  const email = normalizeEmail(formData.get("email"))
  if (!EMAIL_RE.test(email)) return { error: t.actions.invalidEmail }

  const max = readMaxConnections({
    formData,
    plan: { ...plan, maxPages: plan.maxPages },
    t,
    action: "client_create",
    tenantId,
  })
  if (!max.ok) return { error: max.error }

  if (await isEmailTaken(email)) {
    log({
      entrypoint: "action",
      action: "client_create",
      outcome: "failed",
      reason: "email_taken",
      tenantId,
    })
    return { error: t.actions.clientEmailAlreadyRegistered }
  }

  const client = await createClientAccount(tenantId, {
    name: name.value,
    maxConnections: max.value,
  })

  // El correo del cliente vive en la invitación, no en `client_accounts`: si
  // emitirla falla, el cliente quedaría sin correo, sin reenviar posible y solo
  // con «eliminar». Se compensa borrando la fila recién creada; el fallo sigue
  // subiendo, que es lo que pasaba antes de crear nada.
  let sent: boolean
  try {
    sent = await inviteClient({
      session,
      clientAccountId: client.id,
      clientName: client.name,
      email,
    })
  } catch (error) {
    await deleteClientRows(client)
    throw error
  }

  log({
    entrypoint: "action",
    action: "client_create",
    outcome: "ok",
    tenantId,
    clientAccountId: client.id,
  })

  if (posthog) {
    posthog.capture({
      distinctId: tenantId,
      event: "client created",
      properties: {
        client_account_id: client.id,
        max_connections: client.maxConnections,
        invitation_sent: sent,
      },
    })
    await posthog.flush()
  }

  revalidatePath(CLIENTS_PATH)
  return sent
    ? { message: fmt(t.actions.clientCreated, { email }) }
    : { error: t.actions.clientCreatedEmailFailed }
}

// Rango del tope, igual al crear y al editar: `1..maxPages` del plan. Devuelve
// el valor o el mensaje ya traducido, y deja el fallo en el log con el verbo
// de quien lo llamó.
function readMaxConnections(input: {
  formData: FormData
  plan: ClientPlan & { maxPages: number }
  t: Awaited<ReturnType<typeof getAppDict>>
  action: Extract<LogAction, "client_create" | "client_max_update">
  tenantId: string
  clientAccountId?: string
}): { ok: true; value: number } | { ok: false; error: string } {
  const max = validateMaxConnections(
    input.formData.get("maxConnections"),
    input.plan.maxPages
  )
  if (max.ok) return max
  log({
    entrypoint: "action",
    action: input.action,
    outcome: "failed",
    reason: "max_out_of_range",
    tenantId: input.tenantId,
    ...(input.clientAccountId
      ? { clientAccountId: input.clientAccountId }
      : {}),
  })
  return {
    ok: false,
    error: fmt(input.t.actions.clientMaxOutOfRange, {
      maxPages: input.plan.maxPages,
    }),
  }
}

function readClientAccountId(formData: FormData): string | null {
  const value = formData.get("clientAccountId")
  return typeof value === "string" && value ? value : null
}

export async function resendInvitationAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }
  const tenantId = session.user.id

  const clientAccountId = readClientAccountId(formData)
  if (!clientAccountId) return { error: t.actions.clientNotFound }

  const plan = await resolveClientPlan(tenantId)
  if (!plan.canManage) return { error: t.actions.clientsPlanNotAllowed }

  const client = await getClientAccount(tenantId, clientAccountId)
  if (!client) return { error: t.actions.clientNotFound }
  // Un cliente activo ya no tiene nada que aceptar.
  if (client.status !== "pending") {
    return { error: t.actions.clientInvitationNotFound }
  }

  // Reenviar también sirve después de cancelar: el correo es el de la última
  // invitación, viva o no.
  const latest = await getLatestInvitation(clientAccountId)
  if (!latest) return { error: t.actions.clientInvitationNotFound }

  const sent = await inviteClient({
    session,
    clientAccountId,
    clientName: client.name,
    email: latest.email,
  })

  log({
    entrypoint: "action",
    action: "client_invite",
    outcome: "ok",
    tenantId,
    clientAccountId,
  })

  revalidatePath(CLIENTS_PATH)
  return sent
    ? {
        message: fmt(t.actions.clientInvitationResent, { email: latest.email }),
      }
    : { error: t.actions.clientInvitationResentEmailFailed }
}

export async function cancelInvitationAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }
  const tenantId = session.user.id

  const clientAccountId = readClientAccountId(formData)
  if (!clientAccountId) return { error: t.actions.clientNotFound }

  const client = await getClientAccount(tenantId, clientAccountId)
  if (!client) return { error: t.actions.clientNotFound }

  const cancelled = await cancelPendingInvitations(clientAccountId)
  if (cancelled === 0) {
    log({
      entrypoint: "action",
      action: "client_invite_cancel",
      outcome: "failed",
      reason: "invitation_not_found",
      tenantId,
      clientAccountId,
    })
    return { error: t.actions.clientInvitationNotFound }
  }

  log({
    entrypoint: "action",
    action: "client_invite_cancel",
    outcome: "ok",
    tenantId,
    clientAccountId,
  })

  revalidatePath(CLIENTS_PATH)
  return { message: t.actions.clientInvitationCancelled }
}

export async function updateClientMaxAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }
  const tenantId = session.user.id

  const clientAccountId = readClientAccountId(formData)
  if (!clientAccountId) return { error: t.actions.clientNotFound }

  const plan = await resolveClientPlan(tenantId)
  if (!plan.canManage || plan.maxPages === null) {
    return { error: t.actions.clientsPlanNotAllowed }
  }

  // Misma validación de rango que al crear. Un tope menor a lo conectado se
  // acepta: la lista lo pinta en rojo, no se desconecta nada por el cliente.
  const max = readMaxConnections({
    formData,
    plan: { ...plan, maxPages: plan.maxPages },
    t,
    action: "client_max_update",
    tenantId,
    clientAccountId,
  })
  if (!max.ok) return { error: max.error }

  const updated = await updateClientMaxConnections(
    tenantId,
    clientAccountId,
    max.value
  )
  if (!updated) return { error: t.actions.clientNotFound }

  log({
    entrypoint: "action",
    action: "client_max_update",
    outcome: "ok",
    tenantId,
    clientAccountId,
    count: updated.maxConnections,
  })

  revalidatePath(CLIENTS_PATH)
  return { message: t.actions.clientMaxUpdated }
}

// Sin gate de plan a propósito: un padre que bajó de plan tiene que poder
// seguir eliminando clientes. Lo que se va y cómo está en
// `lib/clients/client-deletion.ts`.
export async function deleteClientAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const session = await getSession()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }
  const tenantId = session.user.id

  const clientAccountId = readClientAccountId(formData)
  if (!clientAccountId) return { error: t.actions.clientNotFound }

  const deleted = await deleteClientWithConnections(tenantId, clientAccountId)
  if (!deleted) return { error: t.actions.clientNotFound }

  log({
    entrypoint: "action",
    action: "client_delete",
    outcome: "ok",
    tenantId,
    clientAccountId,
  })

  if (posthog) {
    posthog.capture({
      distinctId: tenantId,
      event: "client deleted",
      properties: { client_account_id: clientAccountId },
    })
    await posthog.flush()
  }

  revalidatePath(CLIENTS_PATH)
  revalidatePath("/connections")
  return { message: t.actions.clientDeleted }
}
