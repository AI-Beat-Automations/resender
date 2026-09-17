import { fmt, type AppDict } from "@/content/i18n/app"
import { cn } from "@/lib/utils"

// Etiqueta con el nombre del [Cliente] dueño de una conexión o de una
// conversación (issue #154, ticket 4). Solo la ve el padre: para él, una fila
// de cliente y una propia son iguales salvo por esto. Sin `"use client"`: la
// pintan igual la tarjeta de Conexiones (isla cliente) y las listas de Inbox
// (server components). El `title` («Cliente: …») lo resuelve acá, una vez.
export function ClientLabel({
  name,
  t,
  size = "row",
  className,
}: {
  name: string
  t: AppDict
  /** `row` (11px, en la fila) o `header` (11.5px, en la cabecera del hilo). */
  size?: "row" | "header"
  className?: string
}) {
  return (
    <span
      title={fmt(t.clients.ownedBy, { name })}
      className={cn(
        "inline-flex max-w-[160px] shrink-0 items-center truncate rounded-full border border-info-soft-border bg-info-soft whitespace-nowrap text-info-soft-foreground",
        size === "row"
          ? "px-[7px] py-px text-[11px]"
          : "px-2 py-0.5 text-[11.5px]",
        className
      )}
    >
      {name}
    </span>
  )
}
