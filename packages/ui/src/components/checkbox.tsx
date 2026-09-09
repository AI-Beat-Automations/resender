"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

// Checkbox del mock (`1g`): 18px, radio 5px, relleno primario al marcar y check
// blanco de 12px con trazo 3. Deshabilitado se apaga con `opacity` y fondo
// hundido, sin cambiar de forma.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-background transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted aria-invalid:border-destructive data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <CheckIcon className="size-3" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
