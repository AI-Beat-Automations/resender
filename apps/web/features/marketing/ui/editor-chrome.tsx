import { cn } from "@workspace/ui/lib/utils"

// Barra superior estilo ventana de editor: semáforo ●●● + un nombre de archivo
// opcional en monospace. Acento "IDE" reutilizable (hero visual, code panel).
// Los tres puntos van en hex a propósito: el mock los fija como los de macOS y
// no hay token semántico que signifique "cerrar/minimizar/maximizar".
export function EditorChrome({
  filename,
  className,
}: {
  filename?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border-subtle bg-surface-sunken px-4 py-2.5",
        className
      )}
    >
      <div className="flex gap-1.5" aria-hidden>
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
      </div>
      {filename ? (
        <span className="ml-2 font-mono text-xs text-muted-foreground">
          {filename}
        </span>
      ) : null}
    </div>
  )
}
