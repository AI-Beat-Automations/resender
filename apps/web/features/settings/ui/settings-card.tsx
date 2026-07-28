import type * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

// Tarjeta estándar del cuerpo de Ajustes (spec C.7): radio 2xl, borde de 1px y
// 22px de padding. `Card` de `packages/ui` usa `ring` en vez de borde y su
// propio `--card-spacing`, así que las pantallas del producto dibujan la suya.
export function SettingsCard({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card p-5.5 shadow-[var(--shadow-xs)]",
        className
      )}
      {...props}
    />
  )
}

export function SettingsCardTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("font-heading text-base font-semibold", className)}
      {...props}
    />
  )
}

// Fila clave-valor sobre `--surface-sunken` con la etiqueta técnica en mono y
// ancho fijo (spec C.5): 82px en Cuenta, 92px en Suscripción.
export function SettingsDataRow({
  label,
  labelWidth = 82,
  children,
}: {
  label: string
  labelWidth?: number
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-sunken px-3.5 py-3">
      <span
        className="shrink-0 font-mono text-[11px] text-muted-foreground"
        style={{ width: `${labelWidth}px` }}
      >
        {label}
      </span>
      {children}
    </div>
  )
}
