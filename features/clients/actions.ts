"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import { describeActorDenial, requireOwner } from "@/lib/auth/actor"
import {
  normalizeClientName,
  normalizeInviteEmail,
} from "@/lib/clients/client-name"
import {
  assignConnectionToClient,
  cancelAgencyClientInvitation,
  createAgencyClient,
  createAgencyClientInvitation,
  deleteAgencyClient,
  renameAgencyClient,
  revokeAgencyClientAccess,
} from "@/lib/clients/client-repository"
import {
  generateInviteToken,
  hashInviteToken,
  invitePath,
} from "@/lib/clients/invite-token"
import { getAppDict } from "@/lib/i18n/app-dict"
import { log } from "@/lib/observability/logger"
import { posthog } from "@/lib/posthog"

// Administrar clientes de agencia desde Conexiones (ADR 0020). **Todo es solo
// del dueño** y cada acción lo verifica: se pueden invocar por POST directo.

export type ClientActionState = {
  error?: string
  message?: string
  /** Cambia en cada éxito: la UI lo usa para cerrar el diálogo. */
  doneAt?: number
}

export type InviteActionState = {
  error?: string
  /**
   * El enlace con el token en claro, **solo** en la respuesta de la acción que
   * lo generó. En la base queda el hash y no hay forma de volver a verlo.
   */
  inviteUrl?: string
}

function readClientId(formData: FormData): string | null {
  const value = formData.get("clientId")
  return typeof value === "string" && value ? value : null
}

export async function createAgencyClientAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const gate = await requireOwner()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }

  const name = normalizeClientName(formData.get("name"))
  if (!name.ok) {
    return {
      error:
        name.error === "name_required"
          ? t.actions.clientNameRequired
          : t.actions.clientNameTooLong,
    }
  }

  const client = await createAgencyClient(gate.actor.tenantId, name.value)

  if (posthog) {
    posthog.capture({
      distinctId: gate.actor.userId,
      event: "agency client created",
      properties: { agency_client_id: client.id },
    })
    await posthog.flush()
  }

  revalidatePath("/connections")
  return { message: t.actions.clientCreated, doneAt: Date.now() }
}

export async function renameAgencyClientAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const gate = await requireOwner()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }

  const clientId = readClientId(formData)
  if (!clientId) return { error: t.actions.clientNotFound }
  const name = normalizeClientName(formData.get("name"))
  if (!name.ok) {
    return {
      error:
        name.error === "name_required"
          ? t.actions.clientNameRequired
          : t.actions.clientNameTooLong,
    }
  }

  const renamed = await renameAgencyClient(
    gate.actor.tenantId,
    clientId,
    name.value
  )
  if (!renamed) return { error: t.actions.clientNotFound }

  revalidatePath("/connections")
  return { message: t.actions.clientRenamed, doneAt: Date.now() }
}

export async function deleteAgencyClientAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const gate = await requireOwner()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }

  const clientId = readClientId(formData)
  if (!clientId) return { error: t.actions.clientNotFound }

  const deleted = await deleteAgencyClient(gate.actor.tenantId, clientId)
  if (!deleted) return { error: t.actions.clientNotFound }

  log({
    entrypoint: "action",
    action: "agency_client_delete",
    outcome: "ok",
    tenantId: gate.actor.tenantId,
  })

  revalidatePath("/connections")
  return { message: t.actions.clientDeleted, doneAt: Date.now() }
}

export async function revokeAgencyClientAccessAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const gate = await requireOwner()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }

  const clientId = readClientId(formData)
  if (!clientId) return { error: t.actions.clientNotFound }

  // Borra el usuario de la persona: queda afuera en su siguiente request,
  // porque el actor se lee vivo y no de la sesión (ADR 0020).
  await revokeAgencyClientAccess(gate.actor.tenantId, clientId)

  log({
    entrypoint: "action",
    action: "agency_client_revoke",
    outcome: "ok",
    tenantId: gate.actor.tenantId,
  })

  revalidatePath("/connections")
  return { message: t.actions.clientAccessRevoked, doneAt: Date.now() }
}

export async function cancelAgencyClientInviteAction(
  _state: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const t = await getAppDict()
  const gate = await requireOwner()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }

  const clientId = readClientId(formData)
  if (!clientId) return { error: t.actions.clientNotFound }

  await cancelAgencyClientInvitation(gate.actor.tenantId, clientId)

  revalidatePath("/connections")
  return { message: t.actions.clientInviteCancelled, doneAt: Date.now() }
}

export async function createAgencyClientInviteAction(
  _state: InviteActionState,
  formData: FormData
): Promise<InviteActionState> {
  const t = await getAppDict()
  const gate = await requireOwner()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }

  const clientId = readClientId(formData)
  if (!clientId) return { error: t.actions.clientNotFound }
  const email = normalizeInviteEmail(formData.get("email"))
  if (!email.ok) return { error: t.actions.inviteEmailInvalid }

  const token = generateInviteToken()
  const created = await createAgencyClientInvitation({
    tenantId: gate.actor.tenantId,
    clientId,
    tokenHash: hashInviteToken(token),
    email: email.value,
  })
  if (!created.ok) {
    return {
      error:
        created.reason === "client_has_member"
          ? t.actions.clientHasMember
          : t.actions.clientNotFound,
    }
  }

  // Nunca el token ni el correo en el log: el token es la credencial.
  log({
    entrypoint: "action",
    action: "agency_client_invite",
    outcome: "ok",
    tenantId: gate.actor.tenantId,
  })

  revalidatePath("/connections")
  return { inviteUrl: `${await appOrigin()}${invitePath(token)}` }
}

/**
 * Asigna una conexión a un cliente o la deja sin asignar (`clientId = null`).
 * Se invoca con argumentos y no con un `<form>`: la dispara un menú.
 */
export async function assignConnectionAction(
  connectionId: string,
  clientId: string | null
): Promise<ClientActionState> {
  const t = await getAppDict()
  const gate = await requireOwner()
  if (!gate.ok) return { error: describeActorDenial(gate.denial, t.actions) }

  if (typeof connectionId !== "string" || !connectionId) {
    return { error: t.actions.invalidPage }
  }
  if (clientId !== null && (typeof clientId !== "string" || !clientId)) {
    return { error: t.actions.clientNotFound }
  }

  const assigned = await assignConnectionToClient({
    tenantId: gate.actor.tenantId,
    connectionId,
    clientId,
  })
  if (!assigned) return { error: t.actions.connectionAssignFailed }

  log({
    entrypoint: "action",
    action: "connection_assign",
    outcome: "ok",
    tenantId: gate.actor.tenantId,
    connectionId,
  })

  revalidatePath("/connections")
  revalidatePath("/inbox")
  return { doneAt: Date.now() }
}

// El enlace lo abre **otra persona**, en otro navegador: va con el dominio
// canónico. El host del request queda de respaldo para desarrollo local.
async function appOrigin(): Promise<string> {
  const configured = process.env.APP_URL
  if (configured) return configured.replace(/\/+$/, "")
  const requestHeaders = await headers()
  const host = requestHeaders.get("host")
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}`
}
