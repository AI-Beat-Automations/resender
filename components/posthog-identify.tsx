"use client"

import { useEffect } from "react"
import { usePostHog } from "posthog-js/react"

import { isPostHogEnabled } from "@/lib/posthog-client"

// Ata la sesión del navegador a la misma persona de PostHog que ya usa el
// servidor (`auth.ts` identifica con `user.id`). Sin esto los $pageview viven en
// una persona anónima distinta a los eventos de servidor, y un usuario aparece
// partido en dos en PostHog.
//
// No se monta en el layout raíz porque tendría que llamar a `auth()`, que lee
// cookies y sacaría de generación estática a la landing, /pricing y /blog. Va en
// cada área autenticada, que ya tiene la sesión en mano.
function PostHogIdentify({
  distinctId,
  email,
}: {
  distinctId: string
  email?: string | null
}) {
  const posthog = usePostHog()

  useEffect(() => {
    if (!isPostHogEnabled || !distinctId) return
    // Ya identificado: repetir el identify solo emitiría un $set por montaje,
    // porque el segundo argumento evita el cortocircuito interno del SDK.
    if (posthog.get_distinct_id() === distinctId) return

    posthog.identify(distinctId, email ? { email } : undefined)
  }, [posthog, distinctId, email])

  return null
}

export { PostHogIdentify }
