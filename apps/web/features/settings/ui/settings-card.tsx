import type * as React from "react"

import {
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

// Composición sobre la `Card` de shadcn para las tarjetas de Ajustes
// (ADR 0015, mocks 1j–1l): no es un componente nuevo, es el patrón repetido
// —título, descripción opcional, acción a la derecha— con la línea inferior
// del mock. Cada panel importa `Card`/`CardContent`/`CardFooter` directo.
export function SettingsCardHeader({
  title,
  description,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<typeof CardHeader>, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <CardHeader className={cn("border-b", className)} {...props}>
      <CardTitle className="font-semibold">{title}</CardTitle>
      {description ? (
        <CardDescription className="text-[13px]">{description}</CardDescription>
      ) : null}
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
  )
}

// Fila clave-valor de la tarjeta «Cuenta» (mock 1j): etiqueta técnica en mono
// con ancho fijo y el valor al lado. Sin fondo propio: la tarjeta ya separa.
export function SettingsDataRow({
  label,
  labelWidth = 110,
  children,
}: {
  label: string
  labelWidth?: number
  children: React.ReactNode
}) {
  return (
    <div
      className="grid items-center gap-3 text-[13.5px]"
      style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
    >
      <span className="font-mono text-[11.5px] text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  )
}
