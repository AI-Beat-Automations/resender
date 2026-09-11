import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Aviso inline del mock (`1e`): tinte suave + borde del mismo tono, radio 10px,
// icono a la izquierda y texto de 13px. La regla del DS es que un tinte suave
// siempre lleva su borde: sobre el blanco, sin él, se desvanece.
const alertVariants = cva(
  "relative flex w-full items-start gap-3 rounded-[10px] border px-3.5 py-3 text-[13px]/[1.5] [&>svg]:mt-px [&>svg]:size-[15px] [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-sunken text-foreground",
        success:
          "border-success-soft-border bg-success-soft text-success-soft-foreground",
        destructive:
          "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
        warning:
          "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
        info: "border-info-soft-border bg-info-soft text-info-soft-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant ?? "default"}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-content"
      className={cn("min-w-0 flex-1", className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("text-[13.5px] font-medium", className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("mt-0.5 text-[13px]/[1.5]", className)}
      {...props}
    />
  )
}

export { Alert, AlertContent, AlertTitle, AlertDescription, alertVariants }
