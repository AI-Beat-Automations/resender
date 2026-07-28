"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/auth"
import {
  createApiKey,
  InvalidApiKeyLabelError,
  revokeApiKey,
} from "@/lib/api-keys/api-keys"
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

export async function createApiKeyAction(
  _state: CreateApiKeyState,
  formData: FormData
): Promise<CreateApiKeyState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No hay sesión iniciada." }

  try {
    const created = await createApiKey(session.user.id, formData.get("label"))

    if (posthog) {
      posthog.capture({
        distinctId: session.user.id,
        event: "api key created",
        properties: {
          api_key_id: created.record.id,
          label: created.record.label,
        },
      })
      await posthog.flush()
    }

    revalidatePath("/settings")
    return {
      apiKey: created.apiKey,
      message: "Copia la key ahora: no vamos a volver a mostrarla.",
    }
  } catch (error) {
    if (error instanceof InvalidApiKeyLabelError) {
      return { error: error.message }
    }
    throw error
  }
}

export async function revokeApiKeyAction(
  _state: RevokeApiKeyState,
  formData: FormData
): Promise<RevokeApiKeyState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No hay sesión iniciada." }

  const apiKeyId = formData.get("apiKeyId")
  if (typeof apiKeyId !== "string" || !apiKeyId) {
    return { error: "La API key no es válida." }
  }

  const revoked = await revokeApiKey(session.user.id, apiKeyId)
  if (!revoked) return { error: "No encontramos la API key." }

  if (posthog) {
    posthog.capture({
      distinctId: session.user.id,
      event: "api key revoked",
      properties: { api_key_id: revoked.id, label: revoked.label },
    })
    await posthog.flush()
  }

  revalidatePath("/settings")
  return { message: "API key revocada." }
}
