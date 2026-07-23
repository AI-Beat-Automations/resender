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
        "scroll-mt-20 border-b border-border/60",
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
  className,
}: {
  // Kicker estilo comentario de código: se renderiza como `// {kicker}` en mono.
  kicker?: string
  title: string
  subtitle?: string
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
      <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
      {subtitle ? (
        <p className="mt-4 text-lg text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  )
}
