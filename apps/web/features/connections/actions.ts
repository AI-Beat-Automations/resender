"use server"

import "server-only"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  PageIdRpcInputSchema,
  PageWebhookUpdateRpcInputSchema,
  type RpcActor,
} from "@workspace/contracts"

import { auth } from "@/auth"
import {
  BackendRpcError,
  disconnectPage,
  rotateWebhookSecret,
  updatePageWebhook,
} from "@/lib/backend/backend"

export type ConnectionActionState = {
  error?: string
  message?: string
  secret?: string
  secretCreatedAt?: string
}

type MutationOutcome<T> =
  | { kind: "success"; value: T }
  | { kind: "redirect"; destination: "/waitlist" | "/billing" }
  | { kind: "form_error"; error: string }

export async function saveWebhookUrlAction(
  _state: ConnectionActionState,
  formData: FormData
): Promise<ConnectionActionState> {
  const actor = await authenticatedActor()
  if (!actor) return { error: "No has iniciado sesión." }

  const pageId = parsePageId(formData)
  if (!pageId) return { error: "Página inválida." }

  const webhookUrl = normalizeWebhookFormValue(formData.get("webhookUrl"))
  if (!webhookUrl.ok) return { error: webhookUrl.error }

  const parsedInput = PageWebhookUpdateRpcInputSchema.safeParse({
    pageId,
    webhookUrl: webhookUrl.value,
  })
  if (!parsedInput.success) return { error: "Webhook inválido." }

  const outcome = await performMutation(() =>
    updatePageWebhook(actor, parsedInput.data)
  )
  if (outcome.kind === "redirect") redirect(outcome.destination)
  if (outcome.kind === "form_error") return { error: outcome.error }

  revalidatePath("/connections")
  return { message: "Webhook actualizado." }
}

export async function disconnectPageAction(
  _state: ConnectionActionState,
  formData: FormData
): Promise<ConnectionActionState> {
  const actor = await authenticatedActor()
  if (!actor) return { error: "No has iniciado sesión." }

  const pageId = parsePageId(formData)
  if (!pageId) return { error: "Página inválida." }

  const outcome = await performMutation(() => disconnectPage(actor, { pageId }))
  if (outcome.kind === "redirect") redirect(outcome.destination)
  if (outcome.kind === "form_error") return { error: outcome.error }

  revalidatePath("/connections")
  return { message: "Página desconectada. El historial se conserva." }
}

export async function rotateWebhookSecretAction(
  _state: ConnectionActionState,
  formData: FormData
): Promise<ConnectionActionState> {
  const actor = await authenticatedActor()
  if (!actor) return { error: "No has iniciado sesión." }

  const pageId = parsePageId(formData)
  if (!pageId) return { error: "Página inválida." }

  const outcome = await performMutation(() =>
    rotateWebhookSecret(actor, { pageId })
  )
  if (outcome.kind === "redirect") redirect(outcome.destination)
  if (outcome.kind === "form_error") return { error: outcome.error }

  revalidatePath("/connections")
  return {
    message: "Secreto creado. Cópialo ahora: no volveremos a mostrarlo.",
    secret: outcome.value.secret,
    secretCreatedAt: outcome.value.createdAt,
  }
}

async function authenticatedActor(): Promise<RpcActor | null> {
  const session = await auth()
  return session?.user?.id ? { userId: session.user.id } : null
}

function parsePageId(formData: FormData): string | null {
  const parsed = PageIdRpcInputSchema.safeParse({
    pageId: formData.get("connectionId"),
  })
  return parsed.success ? parsed.data.pageId : null
}

function normalizeWebhookFormValue(
  value: FormDataEntryValue | null
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Escribe una URL válida." }
  }

  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: "Escribe una URL válida." }
  }
  if (url.protocol !== "https:") {
    return {
      ok: false,
      error:
        "La URL tiene que usar HTTPS. Para desarrollo, usa un túnel HTTPS.",
    }
  }
  return { ok: true, value: url.toString() }
}

async function performMutation<T>(
  operation: () => Promise<T>
): Promise<MutationOutcome<T>> {
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
      return {
        kind: "form_error",
        error: "No encontramos una página activa con ese identificador.",
      }
    }
    if (classification.kind === "validation") {
      return {
        kind: "form_error",
        error:
          "Revisa que uses HTTPS, un destino público y un secreto de firma activo.",
      }
    }
    throw error
  }
}
