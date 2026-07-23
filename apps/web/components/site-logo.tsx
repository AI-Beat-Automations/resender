import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

// Logo de marca: "Resender" en HK Grotesk Bold + ".dev" en Space Mono Bold
// (ver resender-website-spec.md §4). `href` permite reusarlo dentro del app
// (apuntando a la home del producto) además del website.
export function SiteLogo({
  className,
  href = "/",
}: {
  className?: string
  href?: string
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-baseline tracking-tight", className)}
      aria-label="Resender.dev — inicio"
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
