import { BGPattern } from "@workspace/ui/components/bg-pattern"

// Fondo del sitio de marketing: grilla de 40 px, fija al viewport, con la línea
// al 8 % del foreground y un fade radial en los bordes (mock `1a`).
// El componente soporta otras variantes (dots, diagonal-stripes…).
export function SiteBackground() {
  return (
    <BGPattern
      variant="grid"
      mask="fade-edges"
      size={40}
      fill="color-mix(in oklab, var(--foreground) 8%, transparent)"
      className="fixed"
    />
  )
}
