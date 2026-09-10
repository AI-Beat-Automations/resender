import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

// Padding de página de la consola (mock `1e`–`1g`, `1j`–`1l`): 24px
// horizontales, 28px arriba y 32px abajo. Vivía en el layout, pero Inbox
// (mock `1h`/`1i`, ADR 0018) va a sangre completa bajo el header, así que cada
// pantalla lo pide con este envoltorio en vez de heredarlo.
export function ConsolePage({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <div className={cn("px-6 pt-7 pb-8", className)}>{children}</div>
}
