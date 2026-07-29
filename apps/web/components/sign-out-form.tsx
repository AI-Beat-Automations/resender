"use client"

import { usePostHog } from "posthog-js/react"

import { isPostHogEnabled } from "@/lib/posthog-client"

// `<form>` de cerrar sesión que limpia la identidad del navegador antes de
// invocar la server action. Sin el reset, el distinct_id identificado sobrevive
// al logout en localStorage y el siguiente usuario que entre en el mismo
// dispositivo se fusiona con el anterior en PostHog.
//
// Vive en `components/` y no en `features/auth/ui` porque lo consumen el sidebar
// (slice `shell`), /waitlist y /billing: desde `features/auth` sería un import
// entre slices hermanos.
//
// El reset va antes de la acción, no después: las tres actions que recibe
// terminan en `signOut({ redirectTo })`, que lanza NEXT_REDIRECT, así que no
// vuelve nada que observar. Y no pueden devolver un error dejando la sesión
// viva, de modo que aquí adelantarlo no tiene contrapartida.
//
// Envolver la server action en una función cliente convierte el form en client
// action y se pierde el envío sin JavaScript. Aceptable: el reset exige JS de
// todos modos y las tres pantallas ya son interactivas.
function SignOutForm({
  action,
  children,
  className,
}: {
  action: () => Promise<void>
  children: React.ReactNode
  className?: string
}) {
  const posthog = usePostHog()

  return (
    <form
      className={className}
      action={async () => {
        if (isPostHogEnabled) posthog.reset()
        await action()
      }}
    >
      {children}
    </form>
  )
}

export { SignOutForm }
