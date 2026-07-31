import { codeToHtml } from "@/lib/highlighter"

import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { EditorChrome } from "@/features/marketing/ui/editor-chrome"
import { CodeTabs, type Snippet } from "@/features/marketing/ui/code-tabs"
import { buildSnippets } from "@/features/marketing/ui/quickstart-snippets"
import { getDictionary, type Locale } from "@/content/i18n"

// Sección showpiece: panel tipo editor con el snippet de la API resaltado.
// Server component: resaltamos con shiki (temas duales) en build time.
export async function Quickstart({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)

  const snippets: Snippet[] = await Promise.all(
    buildSnippets(dict.quickstart.textSample).map(async (s) => ({
      id: s.id,
      label: s.label,
      code: s.code,
      html: await codeToHtml(s.code, {
        lang: s.lang,
        themes: { light: "github-light", dark: "github-dark" },
        // Sin color inline: los tokens quedan como CSS vars y alternamos por
        // tema (.dark) desde globals.css. Si no, el color claro quedaba fijo e
        // ilegible en modo oscuro.
        defaultColor: false,
      }),
    }))
  )

  return (
    <Section id="quickstart">
      <SectionHeading
        kicker={dict.quickstart.kicker}
        title={dict.quickstart.title}
        subtitle={dict.quickstart.subtitle}
      />
      <div className="mx-auto mt-12 max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <EditorChrome filename={dict.quickstart.filename} />
        <CodeTabs
          snippets={snippets}
          copyLabel={dict.quickstart.copy}
          copiedLabel={dict.quickstart.copied}
        />
      </div>
    </Section>
  )
}
