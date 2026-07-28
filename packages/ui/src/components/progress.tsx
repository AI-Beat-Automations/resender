import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@workspace/ui/lib/utils"

const progressIndicatorVariants = cva(
  "h-full rounded-full transition-[width,background-color] ease-out",
  {
    variants: {
      tone: {
        neutral: "bg-primary",
        warning: "bg-warning",
        destructive: "bg-destructive",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

// Sin Radix ni hooks: es un server component. Con `max <= 0` (o no finito) la
// barra queda indeterminada, no se divide entre cero y no se pinta relleno.
function Progress({
  className,
  value = 0,
  max = 100,
  tone = "neutral",
  ...props
}: Omit<React.ComponentProps<"div">, "children"> &
  VariantProps<typeof progressIndicatorVariants> & {
    value?: number
    max?: number
  }) {
  const hasScale = Number.isFinite(max) && max > 0
  const current = hasScale ? Math.min(Math.max(value, 0), max) : 0
  const percentage = hasScale ? (current / max) * 100 : 0

  return (
    <div
      data-slot="progress"
      data-tone={tone}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={hasScale ? max : undefined}
      aria-valuenow={hasScale ? current : undefined}
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn(progressIndicatorVariants({ tone }))}
        style={{
          width: `${percentage}%`,
          transitionDuration: "var(--duration-fast)",
        }}
      />
    </div>
  )
}

export { Progress, progressIndicatorVariants }
