import { cn } from "@workspace/ui/lib/utils"

// Marquee de preguntas/quejas reales que se mueven en 2 renglones (direcciones
// opuestas). Bubbles redondeadas como el resto de los elementos del sitio.
// CSS puro: el track duplica su contenido y se traslada -50% (ver globals.css).

function Row({ items, reverse }: { items: string[]; reverse?: boolean }) {
  return (
    <div className="flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div
        className={cn(
          "flex w-max shrink-0 items-center gap-3 pr-3 motion-reduce:animate-none",
          reverse ? "animate-marquee-reverse" : "animate-marquee"
        )}
      >
        {[...items, ...items].map((q, i) => (
          <span
            key={i}
            className="whitespace-nowrap rounded-2xl border border-border bg-card px-4 py-2.5 text-sm text-card-foreground shadow-sm"
          >
            {q}
          </span>
        ))}
      </div>
    </div>
  )
}

export function QuestionMarquee({ questions }: { questions: readonly string[] }) {
  const items = [...questions]
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Row items={items} />
      <Row items={[...items].reverse()} reverse />
    </div>
  )
}
