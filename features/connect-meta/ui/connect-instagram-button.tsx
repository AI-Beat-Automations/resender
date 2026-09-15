import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

// Gemelo de `ConnectFacebookButton` para el otro canal: navega al endpoint que
// arranca el OAuth de Instagram (siembra el state CSRF y redirige al diálogo).
// Server component sin estado de cliente, igual que el de Facebook.
//
// Siempre `outline`: en el header conviven los tres canales y en el vacío cada
// tarjeta lleva el suyo; ninguno es «el camino habitual» sobre los otros.
//
// El mismo endpoint sirve para reconectar una cuenta cuyo token venció: en
// Instagram el token muere a los ~60 días, así que reconectar no es el caso
// raro que es en Messenger.
export function ConnectInstagramButton({
  label = "Conectar Instagram",
  size = "lg",
  icon,
  className,
}: {
  label?: string
  size?: "default" | "lg"
  icon?: ReactNode
  className?: string
}) {
  return (
    <Button asChild size={size} variant="outline" className={className}>
      <a href="/api/meta/instagram/start">
        {icon}
        {label}
      </a>
    </Button>
  )
}
