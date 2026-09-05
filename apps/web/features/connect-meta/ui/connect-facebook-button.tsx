import { Plus } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

// Flujo de redirección: el botón solo navega al endpoint que arranca el OAuth de
// Meta (genera el state CSRF y redirige al diálogo). Ya no usa el JS SDK /
// FB.login, así que es un server component sin estado de cliente.
//
// El mismo endpoint sirve para reconectar una página cuyo token rechazó Meta
// (ADR 0005): re-autorizar y conectar por primera vez son el mismo camino.
//
// `variant`/`size`/`icon` son solo piel (ADR 0015): en el header de Conexiones
// va `outline sm` con el «+»; en la tarjeta del estado vacío, `outline` a lo
// ancho y sin icono.
export function ConnectFacebookButton({
  label = "Conectar Facebook",
  variant = "default",
  size = "lg",
  icon = false,
  className,
}: {
  label?: string
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  icon?: boolean
  className?: string
}) {
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <a href="/api/meta/start">
        {icon && <Plus aria-hidden />}
        {label}
      </a>
    </Button>
  )
}
