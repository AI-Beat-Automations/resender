import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

// Logo de marca: cuadro violeta de 28 px con la «r» + "Resender" en HK Grotesk
// Bold + ".dev" en Space Mono Bold (ADR 0015, mock `1a`). El cuadro se dibuja
// igual que en el sidebar de la consola (`features/shell/ui/app-sidebar.tsx`),
// que no reutiliza este componente porque su wordmark va un punto más chico.
// `href` permite reusarlo dentro del app (apuntando a la home del producto)
// además del website; en el sitio público el header/footer le pasan la home
// DEL IDIOMA ACTUAL, para no tirar al visitante de /en de vuelta al español.
// `label` acompaña ese href en el idioma que toque. `tone="inverse"` es para
// superficies `bg-foreground` (footer): ahí el ".dev" va apagado en vez de
// violeta, que sobre el gris oscuro no contrasta.
export function SiteLogo({
  className,
  href = "/",
  label = "Resender.dev — inicio",
  tone = "default",
}: {
  className?: string
  href?: string
  label?: string
  tone?: "default" | "inverse"
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 tracking-[-0.02em]",
        className
      )}
      aria-label={label}
    >
      <span
        className="flex size-7 items-center justify-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground"
        aria-hidden
      >
        r
      </span>
      <span className="flex items-baseline">
        <span className="font-heading text-lg font-bold">Resender</span>
        {/* -ml-0.5 + tracking-tight: acerca ".dev" a "Resender" sin pegarlo (el
            cell de la mono agrega aire alrededor del punto). */}
        <span
          className={cn(
            "-ml-0.5 font-mono text-sm font-bold tracking-tight",
            tone === "inverse" ? "text-background/60" : "text-primary"
          )}
        >
          .dev
        </span>
      </span>
    </Link>
  )
}
