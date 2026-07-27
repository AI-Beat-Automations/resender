import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

// Logo de marca: "Resender" en HK Grotesk Bold + ".dev" en Space Mono Bold
// (ver resender-website-spec.md §4). `href` permite reusarlo dentro del app
// (apuntando a la home del producto) además del website; en el sitio público el
// header/footer le pasan la home DEL IDIOMA ACTUAL, para no tirar al visitante
// de /en de vuelta al español. `label` acompaña ese href en el idioma que toque.
export function SiteLogo({
  className,
  href = "/",
  label = "Resender.dev — inicio",
}: {
  className?: string
  href?: string
  label?: string
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-baseline tracking-tight", className)}
      aria-label={label}
    >
      <span className="font-heading text-lg font-bold">Resender</span>
      {/* -ml-0.5 + tracking-tight: acerca ".dev" a "Resender" sin pegarlo (el
          cell de la mono agrega aire alrededor del punto). */}
      <span className="-ml-0.5 font-mono text-sm font-bold tracking-tight text-primary">
        .dev
      </span>
    </Link>
  )
}
