import { Plus } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

// Gemelo de `ConnectFacebookButton` para el otro canal: navega al endpoint que
// arranca el OAuth de Instagram (siembra el state CSRF y redirige al diálogo).
// Server component sin estado de cliente, igual que el de Facebook.
//
// Variante `outline` por defecto a propósito: los botones conviven en la
// cabecera de Conexiones y dos primarios uno al lado del otro no dicen cuál es
// el camino habitual. Messenger es el canal que hoy atiende producción.
//
// El mismo endpoint sirve para reconectar una cuenta cuyo token venció: en
// Instagram el token muere a los ~60 días, así que reconectar no es el caso
// raro que es en Messenger.
export function ConnectInstagramButton({
  label = "Conectar Instagram",
  variant = "outline",
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
      <a href="/api/meta/instagram/start">
        {icon && <Plus aria-hidden />}
        {label}
      </a>
    </Button>
  )
}
