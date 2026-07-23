import { dict } from "@/content/i18n/es"

// Sección destacada con color de contraste: usa `bg-foreground`/`text-background`,
// así en modo claro se ve con el fondo oscuro de la marca y en modo oscuro con el
// crema — invirtiendo el tono respecto del resto de la página (pedido del founder).
// Layout dividido: título a la izquierda, contenido a la derecha (más dinámico).
export function About() {
  return (
    <section
      id="about"
      className="border-b border-border/60 bg-foreground text-background"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-20 md:grid-cols-[0.8fr_1.2fr] md:py-28">
        <div>
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {dict.about.title}
          </h2>
        </div>
        <div className="space-y-4 text-lg leading-8 text-background/80">
          {dict.about.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </div>
    </section>
  )
}
