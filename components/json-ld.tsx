// Emite un bloque JSON-LD. Server component: el marcado sale en el HTML
// prerenderizado, que es donde lo lee el crawler sin depender de hidratación.
//
// `JSON.stringify` sobre datos del diccionario (no de input de usuario) y con
// `<` escapado, que es el único caracter capaz de cerrar el <script> antes de
// tiempo.
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  )
}
