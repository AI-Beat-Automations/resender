import type { ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"

// Flujo de redirección: el botón solo navega al endpoint que arranca el OAuth de
// Meta (genera el state CSRF y redirige al diálogo). Ya no usa el JS SDK /
// FB.login, así que es un server component sin estado de cliente.
//
// El mismo endpoint sirve para reconectar una página cuyo token rechazó Meta
// (ADR 0005): re-autorizar y conectar por primera vez son el mismo camino.
export function ConnectFacebookButton({
  label = "Conectar Facebook",
  variant = "default",
  size = "lg",
  icon,
  className,
}: {
  label?: string
  variant?: "default" | "outline"
  size?: "default" | "lg"
  icon?: ReactNode
  className?: string
}) {
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <a href="/api/meta/start">
        {icon}
        {label}
      </a>
    </Button>
  )
}
