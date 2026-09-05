import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

// Marquee de preguntas/quejas reales que se mueven en 2 renglones (direcciones
// opuestas). Las píldoras son `Badge variant="outline"` (hereda borde y texto
// de los tokens); se le suelta la altura fija del badge porque acá es una frase
// entera, no una etiqueta.
// CSS puro: el track duplica su contenido y se traslada -50% (ver globals.css).

const BUBBLE = "h-auto rounded-2xl bg-card px-4 py-2.5 text-sm shadow-sm"

// `hidden` marca la fila entera como decorativa. La segunda copia de los items
// siempre lo es: existe solo para que el loop cierre sin salto, no para leerse
// dos veces.
function Row({
  items,
  reverse,
  hidden,
}: {
  items: string[]
  reverse?: boolean
  hidden?: boolean
}) {
  return (
    <div
      aria-hidden={hidden || undefined}
      className="flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]"
    >
      <div
        className={cn(
          "flex w-max shrink-0 items-center gap-3 pr-3",
          reverse ? "animate-marquee-reverse" : "animate-marquee"
        )}
      >
        {items.map((q, i) => (
          <Badge key={`a-${i}`} variant="outline" className={BUBBLE}>
            {q}
          </Badge>
        ))}
        {items.map((q, i) => (
          <Badge
            key={`b-${i}`}
            aria-hidden
            variant="outline"
            className={BUBBLE}
          >
            {q}
          </Badge>
        ))}
      </div>
    </div>
  )
}

// Las preguntas son contenido real (búsquedas long-tail de gente con este
// problema), no adorno: antes el bloque entero iba con `aria-hidden`, así que
// para un lector de pantalla la sección quedaba muda. Ahora se lee una sola vez
// —la primera fila— y las repeticiones que el efecto necesita quedan ocultas.
export function QuestionMarquee({
  questions,
}: {
  questions: readonly string[]
}) {
  const items = [...questions]
  return (
    <div className="flex flex-col gap-3">
      <Row items={items} />
      <Row items={[...items].reverse()} reverse hidden />
    </div>
  )
}
