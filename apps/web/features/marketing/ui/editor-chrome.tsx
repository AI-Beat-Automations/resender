import { cn } from "@workspace/ui/lib/utils"

// Barra superior estilo ventana de editor: semáforo ●●● + un nombre de archivo
// opcional en monospace. Acento "IDE" reutilizable (hero visual, code panel).
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
        "flex items-center gap-2 border-b border-border/70 px-4 py-2.5",
        className
      )}
    >
      <div className="flex gap-1.5" aria-hidden>
        <span className="size-3 rounded-full bg-red-400/80" />
        <span className="size-3 rounded-full bg-yellow-400/80" />
        <span className="size-3 rounded-full bg-green-400/80" />
      </div>
      {filename ? (
        <span className="ml-2 font-mono text-xs text-muted-foreground">
          {filename}
        </span>
      ) : null}
    </div>
  )
}
