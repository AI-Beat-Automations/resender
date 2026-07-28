import "server-only"

import { getPublishedPosts, formatDate, type BlogPost } from "@/lib/blog"
import {
  DOCS_URL,
  SITE_NAME,
  STATIC_CONTENT_UPDATED_AT,
  absoluteUrl,
} from "@/lib/site-config"
import {
  getDictionary,
  localePath,
  type Dict,
  type Locale,
} from "@/content/i18n"

// Builders de /llms.txt y /llms-full.txt, parametrizados por idioma — mismo
// patrón que `lib/blog-rss.ts`. El spec vive en https://llmstxt.org/ y exige,
// en este orden exacto:
//
//   1. un H1 (la única sección obligatoria)
//   2. un blockquote con el resumen
//   3. secciones de cualquier tipo MENOS encabezados (párrafos de contexto)
//   4. secciones delimitadas por H2 con listas `- [nombre](url): detalle`
//
// La H2 llamada literalmente "Optional" es la única con semántica: marca lo que
// un LLM puede saltear si necesita menos contexto. Por eso `sections.optional`
// no se traduce en el diccionario.
//
// Todo el copy sale de `content/i18n` y todas las URLs de `site-config` +
// `localePath`: acá no se hardcodea ni texto ni dominios.

// Largo máximo del detalle de un post en el índice. El índice tiene que poder
// leerse de un vistazo; el texto completo está en /llms-full.txt.
const POST_DETAIL_MAX = 160

function otherLocale(lang: Locale): Locale {
  return lang === "es" ? "en" : "es"
}

function url(path: string, lang: Locale): string {
  return absoluteUrl(localePath(path, lang))
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function truncate(text: string, max: number): string {
  const clean = collapse(text)
  if (clean.length <= max) return clean
  // Corta en el último espacio antes del límite para no partir una palabra.
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]$/, "")}…`
}

// Un item de lista con el formato exacto del spec. El detalle es opcional; si
// viene vacío se omiten los dos puntos en lugar de dejarlos colgando.
function item(label: string, href: string, detail?: string): string {
  const line = `- [${collapse(label)}](${href})`
  const clean = detail ? collapse(detail) : ""
  return clean ? `${line}: ${clean}` : line
}

function section(title: string, items: string[]): string {
  return `## ${title}\n\n${items.join("\n")}`
}

// Une bloques con exactamente una línea en blanco entre ellos, descartando los
// vacíos (una sección sin contenido no debe dejar un hueco doble).
function join(blocks: (string | undefined)[]): string {
  return blocks.filter((b): b is string => Boolean(b && b.trim())).join("\n\n")
}

// Lista "tight": los items van pegados entre sí (sin línea en blanco), que es
// como markdown la renderiza sin envolver cada item en un <p>.
function list(items: string[]): string {
  return items.join("\n")
}

function headerFor(dict: Dict, title: string): string {
  return `# ${title}\n\n> ${collapse(dict.llms.summary)}`
}

// ---------------------------------------------------------------------------
// /llms.txt — el índice curado
// ---------------------------------------------------------------------------

export function buildLlmsTxt(lang: Locale): string {
  const dict = getDictionary(lang)
  const { entries, sections } = dict.llms
  const other = otherLocale(lang)
  const blogUrl = url("/blog", lang)

  const posts = getPublishedPosts(lang).map((post) =>
    item(post.title, `${blogUrl}/${post.slug}`, truncate(post.abstract, POST_DETAIL_MAX))
  )

  return `${join([
    headerFor(dict, SITE_NAME),
    ...dict.llms.context.map(collapse),

    section(sections.product, [
      item(entries.home.label, url("/", lang), entries.home.detail),
      item(entries.pricing.label, url("/pricing", lang), entries.pricing.detail),
      item(
        entries.vsManychat.label,
        url("/vs-manychat", lang),
        entries.vsManychat.detail
      ),
    ]),

    section(sections.docs, [
      item(entries.docs.label, DOCS_URL, entries.docs.detail),
    ]),

    // El índice del blog primero y después cada post publicado, en el mismo
    // orden (más nuevo arriba) que devuelve `getPublishedPosts`.
    section(sections.blog, [
      item(entries.blog.label, blogUrl, entries.blog.detail),
      ...posts,
    ]),

    // Las legales existen solo en español y NO se prefijan: en el índice EN
    // apuntan igual a la raíz, que es donde viven.
    section(sections.legal, [
      item(entries.privacy.label, absoluteUrl("/privacy"), entries.privacy.detail),
      item(entries.terms.label, absoluteUrl("/terms"), entries.terms.detail),
      item(
        entries.dataDeletion.label,
        absoluteUrl("/data-deletion"),
        entries.dataDeletion.detail
      ),
    ]),

    // "Optional" va última por definición: es lo primero que se descarta.
    section(sections.optional, [
      item(entries.full.label, url("/llms-full.txt", lang), entries.full.detail),
      item(
        entries.otherLocale.label,
        url("/llms.txt", other),
        entries.otherLocale.detail
      ),
      item(entries.rss.label, `${blogUrl}/rss.xml`, entries.rss.detail),
    ]),
  ])}\n`
}

// ---------------------------------------------------------------------------
// /llms-full.txt — el volcado completo
// ---------------------------------------------------------------------------

// Baja un nivel los encabezados de un markdown ajeno para que entre bajo un H2
// sin romper la jerarquía del archivo. Ignora lo que esté dentro de un bloque
// de código, donde `#` es un comentario y no un encabezado.
function demoteHeadings(markdown: string): string {
  let inFence = false
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      return line.replace(/^(#{1,5})\s/, "#$1 ")
    })
    .join("\n")
}

function yesNo(value: string | boolean, dict: Dict): string {
  if (value === true) return dict.comparison.yes
  if (value === false) return dict.comparison.no
  return value
}

function page(title: string, path: string, lang: Locale, body: string[]): string {
  const dict = getDictionary(lang)
  return join([
    `## ${title}`,
    `${dict.llms.fullFile.sourceLabel}: ${url(path, lang)}`,
    ...body,
  ])
}

function faqBlock(title: string, items: readonly { q: string; a: string }[]) {
  return join([`### ${title}`, ...items.map((f) => `**${f.q}**\n\n${f.a}`)])
}

function renderLanding(dict: Dict, lang: Locale): string {
  return page(dict.meta.home.title, "/", lang, [
    `${dict.hero.title} ${dict.hero.titleAccent}`,
    dict.hero.subtitle,

    join([
      `### ${dict.pain.title}`,
      dict.pain.subtitle,
      list(dict.pain.items.map((p) => `- **${p.title}**: ${p.body}`)),
    ]),

    join([
      `### ${dict.howItWorks.title}`,
      list(
        dict.howItWorks.steps.map(
          (step, i) => `${i + 1}. **${step.title}**: ${step.body}`
        )
      ),
    ]),

    faqBlock(dict.faq.title, dict.faq.items),
  ])
}

function renderPricing(dict: Dict, lang: Locale): string {
  const plans = dict.pricing.plans.map((plan) =>
    join([
      `#### ${plan.name} — ${plan.price}${plan.period}`,
      plan.description,
      list(plan.features.map((f) => `- ${f}`)),
    ])
  )

  return page(dict.meta.pricing.title, "/pricing", lang, [
    dict.pricing.subtitle,
    ...dict.pricing.intro,
    join([`### ${dict.llms.fullFile.plansTitle}`, ...plans]),
    faqBlock(dict.pricingFaq.title, dict.pricingFaq.items),
  ])
}

function renderVsManychat(dict: Dict, lang: Locale): string {
  const { comparison, vsManychat } = dict
  const table = list([
    `| ${comparison.headers.feature || " "} | ${comparison.headers.resender} | ${comparison.headers.manychat} |`,
    "| --- | --- | --- |",
    ...comparison.rows.map(
      (row) =>
        `| ${row.feature} | ${yesNo(row.resender, dict)} | ${yesNo(row.manychat, dict)} |`
    ),
  ])

  return page(vsManychat.metaTitle, "/vs-manychat", lang, [
    vsManychat.subtitle,
    ...vsManychat.intro,
    join([`### ${dict.llms.fullFile.comparisonTitle}`, table]),
    join([
      `### ${vsManychat.verdict.title}`,
      list(vsManychat.verdict.items.map((v) => `- **${v.when}** → ${v.pick}`)),
    ]),
    faqBlock(vsManychat.faq.title, vsManychat.faq.items),
  ])
}

function renderPost(post: BlogPost, lang: Locale): string {
  const dict = getDictionary(lang)
  const { sourceLabel, publishedLabel } = dict.llms.fullFile
  const meta = [`${sourceLabel}: ${url(`/blog/${post.slug}`, lang)}`]
  if (post.publishedOn) {
    meta.push(`${publishedLabel}: ${formatDate(post.publishedOn, lang)}`)
  }

  return join([
    `## ${post.title}`,
    meta.join("  \n"),
    demoteHeadings(post.content.trim()),
  ])
}

export function buildLlmsFullTxt(lang: Locale): string {
  const dict = getDictionary(lang)
  const posts = getPublishedPosts(lang)

  const note = dict.llms.fullFile.note
    .replace("{index}", url("/llms.txt", lang))
    .replace("{date}", STATIC_CONTENT_UPDATED_AT)

  const blogIndex = page(dict.blog.title, "/blog", lang, [dict.blog.intro])

  const blocks = [
    // El encabezado y su nota son un solo bloque: el `---` separa páginas, y la
    // nota no es una página.
    join([headerFor(dict, dict.llms.fullFile.title), note]),
    renderLanding(dict, lang),
    renderPricing(dict, lang),
    renderVsManychat(dict, lang),
    blogIndex,
    ...posts.map((post) => renderPost(post, lang)),
  ]

  // `---` entre páginas: separador visible para un lector y regla horizontal
  // válida en markdown, así el archivo sigue siendo markdown legítimo.
  return `${blocks.join("\n\n---\n\n")}\n`
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

// `text/plain` y no `text/markdown`: el spec sirve estos archivos como texto y
// es lo que los crawlers esperan poder leer sin descargar nada.
function textResponse(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}

export function llmsTxtResponse(lang: Locale): Response {
  return textResponse(buildLlmsTxt(lang))
}

export function llmsFullTxtResponse(lang: Locale): Response {
  return textResponse(buildLlmsFullTxt(lang))
}
