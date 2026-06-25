"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/auth"
import {
  createApiKey,
  InvalidApiKeyLabelError,
  revokeApiKey,
} from "@/lib/api-keys/api-keys"

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
  if (!session?.user?.id) return { error: "Not authenticated." }

  try {
    const created = await createApiKey(session.user.id, formData.get("label"))
    revalidatePath("/settings")
    return {
      apiKey: created.apiKey,
      message: "API key created. Copy it now; it won't be shown again.",
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
  if (!session?.user?.id) return { error: "Not authenticated." }

  const apiKeyId = formData.get("apiKeyId")
  if (typeof apiKeyId !== "string" || !apiKeyId) {
    return { error: "Invalid API key." }
  }

  const revoked = await revokeApiKey(session.user.id, apiKeyId)
  if (!revoked) return { error: "API key not found." }

  revalidatePath("/settings")
  return { message: "API key revoked." }
}
