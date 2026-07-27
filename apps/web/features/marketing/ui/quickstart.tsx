import { codeToHtml } from "@/lib/highlighter"

import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { EditorChrome } from "@/features/marketing/ui/editor-chrome"
import { CodeTabs, type Snippet } from "@/features/marketing/ui/code-tabs"
import { getDictionary, type Locale } from "@/content/i18n"

// Snippets reales del endpoint de salida (ver app/api/meta/send y /docs).
// Placeholders obvios, nunca secretos reales. Lo único que varía por idioma es
// el texto de ejemplo del campo `reply`; el resto son identificadores de la API.
function buildSnippets(reply: string) {
  return [
    {
      id: "curl",
      label: "curl",
      lang: "bash",
      code: `curl -X POST https://resender.dev/api/meta/send \\
  -H "Authorization: Bearer pk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "pageId": "1029384756",
    "recipientId": "6543210987",
    "reply": "${reply}"
  }'`,
    },
    {
      id: "node",
      label: "Node.js",
      lang: "javascript",
      code: `await fetch("https://resender.dev/api/meta/send", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.RESENDER_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    pageId: "1029384756",
    recipientId: "6543210987",
    reply: "${reply}",
  }),
})`,
    },
    {
      id: "python",
      label: "Python",
      lang: "python",
      code: `import requests

requests.post(
    "https://resender.dev/api/meta/send",
    headers={"Authorization": f"Bearer {key}"},
    json={
        "pageId": "1029384756",
        "recipientId": "6543210987",
        "reply": "${reply}",
    },
)`,
    },
  ]
}

// Sección showpiece: panel tipo editor con el snippet de la API resaltado.
// Server component: resaltamos con shiki (temas duales) en build time.
export async function Quickstart({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)

  const snippets: Snippet[] = await Promise.all(
    buildSnippets(dict.quickstart.replySample).map(async (s) => ({
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
