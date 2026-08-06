import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { resolveProductAccess } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import {
  assertSecretEncryptionConfigured,
  SecretEncryptionConfigError,
} from "@/lib/crypto/encryption"
import {
  exchangeCodeForInstagramToken,
  fetchInstagramProfile,
  InstagramApiError,
  INSTAGRAM_STATE_COOKIE,
  subscribeInstagramWebhook,
} from "@/lib/instagram"
import { APP_URL } from "@/lib/meta"
import { instagramAccountOwnedReason } from "@/lib/pages/meta-connection-error"
import {
  connectInstagramAccount,
  PageOwnershipError,
} from "@/lib/pages/page-registry"
import { posthog } from "@/lib/posthog"

// Instagram redirige acá con ?code=...&state=... tras aprobar el diálogo.
//
// A diferencia del callback de Facebook, este **sí conecta**. La ADR 0004 mandó
// la selección a una pantalla aparte porque Facebook devuelve N páginas y
// persistir los page tokens de las que el usuario no eligió era el problema;
// Instagram Login autoriza exactamente una cuenta, así que no hay nada que
// elegir y una pantalla intermedia solo agregaría un clic.
//
// El orden importa: primero se suscribe al webhook y recién después se guarda.
// Una cuenta guardada que no recibe eventos se ve conectada y está muda; una
// suscripción sin fila en la base no le hace nada a nadie —los eventos llegan y
// no resuelven a ningún tenant— y se limpia sola al reintentar.
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", APP_URL))
  }

  // Ver el comentario en `/api/meta/instagram/start`.
  const access = await resolveProductAccess(session.user.id)
  if (access === "unknown_user") {
    return NextResponse.redirect(new URL("/login", APP_URL))
  }
  if (access === "waitlisted") {
    return NextResponse.redirect(new URL("/waitlist", APP_URL))
  }

  if (!(await hasActiveSubscription(session.user.id))) {
    return NextResponse.redirect(new URL("/billing", APP_URL))
  }

  const params = request.nextUrl.searchParams
  const code = params.get("code")
  const state = params.get("state")
  const error = params.get("error")

  const connections = new URL("/connections", APP_URL)
  const finish = (search: Record<string, string>) => {
    for (const [key, value] of Object.entries(search)) {
      connections.searchParams.set(key, value)
    }
    const res = NextResponse.redirect(connections)
    res.cookies.delete(INSTAGRAM_STATE_COOKIE)
    return res
  }

  const fail = (reason: string) => finish({ instagram: "error", reason })

  // El usuario canceló, o Instagram devolvió error. `error_description` trae el
  // detalle pero es texto de Meta en inglés: nos quedamos con el código, que es
  // lo que el catálogo de mensajes sabe traducir.
  if (error || !code) return fail(error ?? "missing_code")

  // CSRF: el state del query debe coincidir con la cookie que sembró /start.
  const expected = request.cookies.get(INSTAGRAM_STATE_COOKIE)?.value
  if (!state || !expected || state !== expected) return fail("state_mismatch")

  let step: "exchange" | "profile" | "subscribe" | "persist" = "exchange"
  try {
    assertSecretEncryptionConfigured()

    const token = await exchangeCodeForInstagramToken(code)

    step = "profile"
    const profile = await fetchInstagramProfile(token.accessToken)

    step = "subscribe"
    await subscribeInstagramWebhook(token.accessToken)

    step = "persist"
    const account = await connectInstagramAccount(session.user.id, {
      igUserId: profile.igUserId,
      username: profile.username,
      name: profile.name,
      accessToken: token.accessToken,
      tokenExpiresAt: token.expiresAt,
    })

    if (posthog) {
      posthog.capture({
        distinctId: session.user.id,
        event: "instagram account connected",
        properties: {
          connection_id: account.id,
          ig_user_id: account.metaPageId,
          username: account.username,
        },
      })
      await posthog.flush()
    }

    // Solo el @handle viaja en la URL. El token quedó cifrado en Postgres y el
    // IG ID no le dice nada al usuario.
    return finish({ instagram: "connected", username: profile.username })
  } catch (error) {
    if (posthog) posthog.captureException(error, session.user.id)
    console.error("instagram connection failed", step, error)

    if (error instanceof SecretEncryptionConfigError) {
      return fail("configuration_failed")
    }
    if (error instanceof PageOwnershipError) {
      return fail(instagramAccountOwnedReason(error.metaPageId))
    }
    if (error instanceof InstagramApiError) {
      return fail(
        error.step === "subscribe"
          ? "instagram_subscription_failed"
          : error.step === "profile"
            ? "instagram_profile_failed"
            : "instagram_exchange_failed"
      )
    }
    return fail("instagram_exchange_failed")
  }
}
