import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

// La cadena base es literalmente la que estaba duplicada en los formularios:
// no se añade `w-full` para no cambiar el layout de los que ya viven en flex.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
