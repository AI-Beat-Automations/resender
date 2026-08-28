"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/auth"
import { getAppDict } from "@/lib/i18n/app-dict"
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
  const t = await getAppDict()
  const session = await auth()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

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
      message: t.actions.apiKeyRevealed,
    }
  } catch (error) {
    if (error instanceof InvalidApiKeyLabelError) {
      return {
        error:
          error.code === "label_required"
            ? t.actions.apiKeyLabelRequired
            : t.actions.apiKeyLabelTooLong,
      }
    }
    throw error
  }
}

export async function revokeApiKeyAction(
  _state: RevokeApiKeyState,
  formData: FormData
): Promise<RevokeApiKeyState> {
  const t = await getAppDict()
  const session = await auth()
  if (!session?.user?.id) return { error: t.actions.notSignedIn }

  const apiKeyId = formData.get("apiKeyId")
  if (typeof apiKeyId !== "string" || !apiKeyId) {
    return { error: t.actions.invalidApiKey }
  }

  const revoked = await revokeApiKey(session.user.id, apiKeyId)
  if (!revoked) return { error: t.actions.apiKeyNotFound }

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
