import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// Burbuja del hilo (mock `1h`/`1i`, ADR 0018), compartida por mensajes y
// comentarios: entrante a la izquierda con borde, saliente a la derecha
// rellena de primario, esquina interior de 4px. El saliente que Meta rechazó
// se "vacía" y se orla en rojo en vez de rellenarse.
//
// El metadato va **debajo** en mensajes y **encima** en comentarios, tal cual
// dibuja el mock cada pantalla; el resto es idéntico a propósito: un comentario
// y un DM son un ida y vuelta con la misma persona.
export function Bubble({
  outbound,
  failed,
  dayLabel,
  meta,
  metaPlacement,
  error,
  after,
  children,
}: {
  outbound: boolean
  failed: boolean
  /** Separador de fecha cuando abre un día nuevo. */
  dayLabel: string | null
  meta: ReactNode
  metaPlacement: "above" | "below"
  /** Error crudo del proveedor, solo en `failed`. */
  error: string | null
  /** Lo que cuelga de la burbuja (reacciones). */
  after?: ReactNode
  children: ReactNode
}) {
  const metaNode = (
    <p
      className={cn(
        "flex items-center gap-1.5 font-mono text-[10.5px]",
        metaPlacement === "above" ? "mb-1" : "mt-1",
        outbound && "justify-end",
        failed ? "text-[var(--danger-text)]" : "text-[var(--text-subtle)]"
      )}
    >
      {meta}
    </p>
  )

  return (
    <>
      {dayLabel ? (
        <p className="self-center font-mono text-[10.5px] text-[var(--text-subtle)]">
          {dayLabel}
        </p>
      ) : null}
      <article
        className={cn(
          "flex max-w-[60%] flex-col",
          outbound ? "items-end self-end" : "items-start self-start"
        )}
      >
        {metaPlacement === "above" ? metaNode : null}
        <div
          className={cn(
            "rounded-[14px] border px-3.5 py-2.5 text-[14px] leading-normal break-words whitespace-pre-wrap",
            outbound ? "rounded-br-[4px]" : "rounded-bl-[4px]",
            failed
              ? "border-[var(--danger-soft-border)] bg-card text-foreground"
              : outbound
                ? "border-bubble-out-border bg-bubble-out text-bubble-out-foreground"
                : "border-bubble-in-border bg-bubble-in text-bubble-in-foreground"
          )}
        >
          {children}
        </div>
        {after}
        {metaPlacement === "below" ? metaNode : null}
        {error ? (
          <p
            className={cn(
              "mt-1 font-mono text-[10.5px] text-[var(--danger-text)]",
              outbound ? "text-right" : "text-left"
            )}
          >
            {error}
          </p>
        ) : null}
      </article>
    </>
  )
}
