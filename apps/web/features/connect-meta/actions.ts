"use server"

import { ConnectMetaPagesRpcInputSchema } from "@workspace/contracts"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
  connectMetaPages,
} from "@/lib/backend/backend"

export type ConnectMetaActionState = {
  error?: string
  message?: string
}

export async function connectSelectedPagesAction(
  _state: ConnectMetaActionState,
  formData: FormData
): Promise<ConnectMetaActionState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "No has iniciado sesión." }

  const parsed = ConnectMetaPagesRpcInputSchema.safeParse({
    providerPageIds: formData.getAll("pageIds"),
  })
  if (!parsed.success) {
    return { error: "Elige al menos una página válida." }
  }

  let pages
  try {
    pages = await connectMetaPages({ userId: session.user.id }, parsed.data)
  } catch (error) {
    return connectFailure(error)
  }

  revalidatePath("/connections")
  redirect(
    `/connections?meta=connected&pages=${encodeURIComponent(
      JSON.stringify(
        pages.map((page) => ({
          id: page.providerPageId,
          name: page.name,
        }))
      )
    )}`
  )
}

function connectFailure(error: unknown): ConnectMetaActionState {
  if (error instanceof BackendRpcError) {
    if (error.classification.code === "account_waitlisted") {
      return { error: "Tu cuenta está en la lista de espera." }
    }
    if (error.classification.code === "subscription_required") {
      return { error: "Tu suscripción no está activa." }
    }
    if (
      error.classification.code === "page_limit_exceeded" ||
      error.classification.code === "plan_unavailable"
    ) {
      return {
        error:
          "No tienes cupo disponible para esa selección. Desconecta una página o revisa tu plan.",
      }
    }
    if (
      error.classification.code === "not_found" ||
      error.classification.kind === "validation"
    ) {
      return {
        error:
          "Esa selección ya no está disponible. Recarga la pantalla e inténtalo de nuevo.",
      }
    }
    if (error.classification.kind === "provider") {
      return {
        error:
          "Las páginas seleccionadas ya no están disponibles. Vuelve a conectar Facebook e inténtalo de nuevo.",
      }
    }
  }

  if (
    error instanceof BackendUnavailableError ||
    error instanceof BackendProtocolError ||
    error instanceof BackendRpcError
  ) {
    return {
      error:
        "No pudimos conectar las páginas en este momento. Inténtalo de nuevo.",
    }
  }

  return {
    error: "No se pudo conectar. Inténtalo de nuevo.",
  }
}
