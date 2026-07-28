import { cn } from "@workspace/ui/lib/utils"

// Wrapper de sección para la landing/pricing. `tone` alterna entre el fondo base
// y una superficie elevada (card/muted) para separar visualmente las secciones
// (ver resender-website-spec.md §4).
export function Section({
  id,
  tone = "base",
  className,
  children,
}: {
  id?: string
  tone?: "base" | "muted"
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20",
        tone === "muted" && "bg-muted/40",
        className
      )}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
        {children}
      </div>
    </section>
  )
}

export function SectionHeading({
  kicker,
  title,
  subtitle,
  as: Heading = "h2",
  className,
}: {
  // Kicker estilo comentario de código: se renderiza como `// {kicker}` en mono.
  kicker?: string
  title: string
  subtitle?: string
  // Nivel del encabezado. Por defecto h2, porque en la landing el h1 lo pone el
  // hero. Las páginas cuya primera sección ES el encabezado principal
  // (/pricing, /blog, /vs-manychat) pasan "h1": sin esto quedaban sin h1.
  as?: "h1" | "h2"
  className?: string
}) {
  return (
    <div className={cn("mx-auto max-w-2xl text-center", className)}>
      {kicker ? (
        <p className="mb-3 font-mono text-sm text-primary">
          <span className="text-muted-foreground">{"// "}</span>
          {kicker}
        </p>
      ) : null}
      <Heading className="text-3xl font-bold tracking-tight md:text-4xl">
        {title}
      </Heading>
      {subtitle ? (
        <p className="mt-4 text-lg text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  )
}
