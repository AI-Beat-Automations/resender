import { BGPattern } from "@workspace/ui/components/bg-pattern"

// Fondo del sitio de marketing: patrón de grilla (grid) sutil, fijo al viewport,
// con fill que se adapta al tema (mezcla del foreground) y un fade en los bordes.
// El componente soporta otras variantes (dots, diagonal-stripes…).
export function SiteBackground() {
  return (
    <BGPattern
      variant="grid"
      mask="fade-edges"
      size={40}
      fill="color-mix(in oklab, var(--foreground) 10%, transparent)"
      className="fixed"
    />
  )
}
