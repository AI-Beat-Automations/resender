"use server"

import "server-only"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  ApiKeyCreateRpcInputSchema,
  ApiKeyRevokeRpcInputSchema,
  type ApiKeyDto,
  type RpcActor,
} from "@workspace/contracts"

import { auth } from "@/auth"
import {
  BackendRpcError,
  createApiKey,
  revokeApiKey,
} from "@/lib/backend/backend"
import { posthog } from "@/lib/posthog"

export type CreateApiKeyState = {
  error?: string
  apiKey?: string
  message?: string
}

export type RevokeApiKeyState = {
  error?: string
  message?: string
}

type ApiKeyMutationOutcome<T> =
  | { kind: "success"; value: T }
  | { kind: "redirect"; destination: "/waitlist" | "/billing" }
  | { kind: "form_error"; error: string }

export async function createApiKeyAction(
  _state: CreateApiKeyState,
  formData: FormData
): Promise<CreateApiKeyState> {
  const actor = await authenticatedActor()
  if (!actor) return { error: "No hay sesión iniciada." }

  const labelValue = formData.get("label")
  const label = typeof labelValue === "string" ? labelValue.trim() : ""
  if (!label) return { error: "Escribe una etiqueta para la key." }
  if (label.length > 80) {
    return { error: "La etiqueta no puede pasar de 80 caracteres." }
  }
  const input = ApiKeyCreateRpcInputSchema.safeParse({ label })
  if (!input.success) return { error: "La etiqueta no es válida." }

  const outcome = await performApiKeyMutation(
    () => createApiKey(actor, input.data),
    "No pudimos crear la API key con esa etiqueta.",
    "account"
  )
  if (outcome.kind === "redirect") redirect(outcome.destination)
  if (outcome.kind === "form_error") return { error: outcome.error }

  await captureApiKeyEvent("api key created", actor, outcome.value.record)
  revalidatePath("/settings")
  return {
    apiKey: outcome.value.apiKey,
    message: "Copia la key ahora: no vamos a volver a mostrarla.",
  }
}

export async function revokeApiKeyAction(
  _state: RevokeApiKeyState,
  formData: FormData
): Promise<RevokeApiKeyState> {
  const actor = await authenticatedActor()
  if (!actor) return { error: "No hay sesión iniciada." }

  const input = ApiKeyRevokeRpcInputSchema.safeParse({
    apiKeyId: formData.get("apiKeyId"),
  })
  if (!input.success) return { error: "La API key no es válida." }

  const outcome = await performApiKeyMutation(
    () => revokeApiKey(actor, input.data),
    "La API key no es válida.",
    "api_key"
  )
  if (outcome.kind === "redirect") redirect(outcome.destination)
  if (outcome.kind === "form_error") return { error: outcome.error }

  await captureApiKeyEvent("api key revoked", actor, outcome.value)
  revalidatePath("/settings")
  return { message: "API key revocada." }
}

async function authenticatedActor(): Promise<RpcActor | null> {
  const session = await auth()
  return session?.user?.id ? { userId: session.user.id } : null
}

async function performApiKeyMutation<T>(
  operation: () => Promise<T>,
  validationError: string,
  notFoundResource: "account" | "api_key"
): Promise<ApiKeyMutationOutcome<T>> {
  try {
    return { kind: "success", value: await operation() }
  } catch (error) {
    if (!(error instanceof BackendRpcError)) throw error
    const { classification } = error
    if (classification.code === "account_waitlisted") {
      return { kind: "redirect", destination: "/waitlist" }
    }
    if (classification.code === "subscription_required") {
      return { kind: "redirect", destination: "/billing" }
    }
    if (classification.kind === "not_found") {
      if (notFoundResource === "account") {
        return { kind: "redirect", destination: "/waitlist" }
      }
      return { kind: "form_error", error: "No encontramos la API key." }
    }
    if (classification.kind === "validation") {
      return { kind: "form_error", error: validationError }
    }
    throw error
  }
}

async function captureApiKeyEvent(
  event: "api key created" | "api key revoked",
  actor: RpcActor,
  apiKey: ApiKeyDto
) {
  if (!posthog) return
  try {
    posthog.capture({
      distinctId: actor.userId,
      event,
      properties: { api_key_id: apiKey.id, label: apiKey.label },
    })
    await posthog.flush()
  } catch {
    // Analytics is non-authoritative and receives metadata only, never the key.
  }
}
