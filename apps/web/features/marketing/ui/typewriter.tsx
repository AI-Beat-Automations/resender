import { cn } from "@workspace/ui/lib/utils"

// Efecto máquina de escribir 100% CSS. El texto completo va en el HTML servido
// y la animación solo revela su ancho, así que el H1 del hero llega entero al
// crawler (antes se tipeaba con estado de React y el HTML prerenderizado salía
// con el span vacío: "Developer-first." solo aparecía después de hidratar).
//
// El reveal usa `max-width` con un margen del 20% sobre el ancho estimado en
// `ch`: si el glifo "0" de la fuente es más angosto que el promedio real, el
// tope queda por encima del ancho natural y el texto nunca se corta.
// `prefers-reduced-motion` lo muestra estático (ver globals.css).
export function Typewriter({
  text,
  className,
  speed = 60,
}: {
  text: string
  className?: string
  /** Milisegundos por caracter. */
  speed?: number
}) {
  return (
    <span
      className={cn("typewriter", className)}
      style={
        {
          "--typewriter-chars": text.length,
          "--typewriter-duration": `${text.length * speed}ms`,
        } as React.CSSProperties
      }
    >
      {text}
    </span>
  )
}
