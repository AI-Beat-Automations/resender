import "server-only"

import fs from "node:fs"
import path from "node:path"

import matter from "gray-matter"
import GithubSlugger from "github-slugger"

import { locales, type Locale } from "@/content/i18n/dictionary"

// Loader del blog. Los posts se escriben como .md/.mdx bajo
// content/blog/<idioma>/ y se renderizan en build time (SSG).
//
// El idioma sale de la CARPETA (content/blog/es · content/blog/en), no del
// frontmatter: así la versión ES y la EN de un mismo artículo comparten slug y
// el switch ES/EN nunca cae en un 404.
//
// El frontmatter YAML es OPCIONAL: si falta, todo se deriva del propio texto del
// archivo (ver resender-website-spec.md §3.3):
//   # Título               -> primer encabezado H1
//   *23 de julio de 2026*  -> primera línea en cursiva que parezca fecha
//   Primer párrafo         -> abstract
// El nombre del archivo define la URL (slug). Ver content/blog/_COMO-PUBLICAR.md.

export type BlogCategory = "tutorial" | "actualizacion"

export type BlogFrontmatter = {
  title: string
  abstract: string
  category?: BlogCategory
  isPublished: boolean
  publishedOn: string
  updatedOn?: string
  author?: string
  lang: string
}

export type BlogPost = BlogFrontmatter & {
  slug: string
  content: string
}

export type BlogHeading = {
  depth: number
  text: string
  id: string
}

const BLOG_DIR = path.join(process.cwd(), "content", "blog")

// Meses en español e inglés (con las abreviaturas más comunes), para que un post
// en /en pueda fechar con "July 23, 2026" y uno en /es con "23 de julio de 2026".
const MONTHS: Record<string, number> = {
  enero: 1,
  january: 1,
  jan: 1,
  febrero: 2,
  february: 2,
  feb: 2,
  marzo: 3,
  march: 3,
  mar: 3,
  abril: 4,
  april: 4,
  apr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  june: 6,
  jun: 6,
  julio: 7,
  july: 7,
  jul: 7,
  agosto: 8,
  august: 8,
  aug: 8,
  septiembre: 9,
  setiembre: 9,
  september: 9,
  sep: 9,
  sept: 9,
  octubre: 10,
  october: 10,
  oct: 10,
  noviembre: 11,
  november: 11,
  nov: 11,
  diciembre: 12,
  december: 12,
  dec: 12,
}

// Parsea una fecha escrita por el autor. Acepta:
//   "23 de julio de 2026" · "July 23, 2026" · "23 July 2026"
//   "2026-07-23" (ISO) · "23/07/2026" (dd/mm/yyyy)
// Devuelve YYYY-MM-DD, o null si no matchea ningún formato.
export function parsePostDate(value: string): string | null {
  const raw = value.trim()

  const es = raw.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i)
  if (es) {
    const month = MONTHS[(es[2] ?? "").toLowerCase()]
    if (month) return toIso(Number(es[3]), month, Number(es[1]))
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  // Ojo: dd/mm/yyyy también para posts en inglés. Es la convención del sitio;
  // si querés evitar la ambigüedad, usá ISO o el mes con nombre.
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) return toIso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))

  // "July 23, 2026" / "Jul 23 2026"
  const mdy = raw.match(
    /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i
  )
  if (mdy) {
    const month = MONTHS[(mdy[1] ?? "").toLowerCase()]
    if (month) return toIso(Number(mdy[3]), month, Number(mdy[2]))
  }

  // "23 July 2026" / "23rd July, 2026"
  const dmyName = raw.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/i
  )
  if (dmyName) {
    const month = MONTHS[(dmyName[2] ?? "").toLowerCase()]
    if (month) return toIso(Number(dmyName[3]), month, Number(dmyName[1]))
  }

  return null
}

function toIso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${year}-${mm}-${dd}`
}

// Mapea el texto de una categoría escrita por el autor ("Tutorial", "Novedades",
// "News", con o sin acentos) al valor interno. La clave interna sigue siendo
// `actualizacion` aunque la etiqueta visible pasó a ser "Novedades" / "News".
// Devuelve null si no coincide con ninguna categoría conocida.
export function parseCategoryLabel(text: string): BlogCategory | null {
  const norm = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
  if (norm === "tutorial" || norm === "tutoriales" || norm === "tutorials")
    return "tutorial"
  if (
    norm === "actualizacion" ||
    norm === "actualizaciones" ||
    norm === "novedad" ||
    norm === "novedades" ||
    norm === "news" ||
    norm === "update" ||
    norm === "updates"
  )
    return "actualizacion"
  return null
}

// Parsea la línea "meta" en cursiva del post. Acepta solo fecha
// ("23 de julio de 2026") o categoría + fecha separadas por · • o |
// ("Tutorial · 23 de julio de 2026"), en cualquier orden.
function parseMetaLine(inner: string): {
  date?: string
  category?: BlogCategory
} {
  const parts = inner
    .split(/[·•|]/)
    .map((s) => s.trim())
    .filter(Boolean)

  let date: string | undefined
  let category: BlogCategory | undefined
  for (const part of parts) {
    const asDate = parsePostDate(part)
    if (asDate) {
      date = asDate
      continue
    }
    const asCategory = parseCategoryLabel(part)
    if (asCategory) category = asCategory
  }
  return { date, category }
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

// Derivación desde markdown puro (sin frontmatter). Extrae el título (primer H1)
// y la fecha (primera línea en cursiva que parezca fecha) y los QUITA del cuerpo
// para que la página no los duplique.
function deriveFromBody(body: string): {
  title?: string
  publishedOn?: string
  category?: BlogCategory
  abstract?: string
  content: string
} {
  const lines = body.split("\n")
  let title: string | undefined
  let publishedOn: string | undefined
  let category: BlogCategory | undefined
  const kept: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (!title) {
      const h1 = trimmed.match(/^#\s+(.+)$/)
      if (h1?.[1]) {
        title = h1[1].trim()
        continue
      }
    }

    // Línea en cursiva completa (*...* o _..._) con la fecha y, opcionalmente,
    // la categoría ("Tutorial · 23 de julio de 2026"). Solo se consume si trae
    // fecha, para no confundirla con una cursiva cualquiera del texto.
    if (!publishedOn) {
      const italic = trimmed.match(/^[*_](.+?)[*_]$/)
      if (italic?.[1]) {
        const meta = parseMetaLine(italic[1])
        if (meta.date) {
          publishedOn = meta.date
          category = meta.category
          continue
        }
      }
    }

    kept.push(line)
  }

  const content = kept.join("\n").replace(/^\n+/, "")
  const abstract = firstParagraph(content)

  return { title, publishedOn, category, abstract, content }
}

// Primer párrafo de texto plano: salta encabezados, imágenes y líneas vacías.
function firstParagraph(content: string): string | undefined {
  for (const block of content.split(/\n\s*\n/)) {
    const text = block.trim()
    if (!text) continue
    if (text.startsWith("#")) continue
    if (text.startsWith("!")) continue
    return text.replace(/\s+/g, " ").trim()
  }
  return undefined
}

// Parseo puro (sin filesystem): útil para tests. Acepta frontmatter YAML o
// markdown puro con título/fecha derivados del cuerpo. `lang` viene de la
// carpeta; el frontmatter solo se usa como fallback.
export function parsePost(
  raw: string,
  slug: string,
  lang?: string
): BlogPost | null {
  const { data, content } = matter(raw)

  const derived: ReturnType<typeof deriveFromBody> = data.title
    ? { content }
    : deriveFromBody(content)

  const title = data.title ? String(data.title) : derived.title
  if (!title) return null

  const publishedOnRaw = data.publishedOn ?? derived.publishedOn
  const abstract = data.abstract ?? derived.abstract ?? ""

  return {
    slug,
    title,
    abstract: String(abstract),
    category: (data.category as BlogCategory) ?? derived.category ?? undefined,
    isPublished: data.isPublished !== false,
    publishedOn: publishedOnRaw ? normalizeDate(publishedOnRaw) : "",
    updatedOn: data.updatedOn ? normalizeDate(data.updatedOn) : undefined,
    author: data.author ? String(data.author) : undefined,
    lang: lang ?? String(data.lang ?? "es"),
    content: derived.content,
  }
}

function readPost(lang: Locale, fileName: string): BlogPost | null {
  const slug = fileName.replace(/\.mdx?$/, "")
  const raw = fs.readFileSync(path.join(BLOG_DIR, lang, fileName), "utf-8")
  return parsePost(raw, slug, lang)
}

function readAllPosts(lang: Locale): BlogPost[] {
  const dir = path.join(BLOG_DIR, lang)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /\.mdx?$/.test(f) && !f.startsWith("_"))
    .map((f) => readPost(lang, f))
    .filter((p): p is BlogPost => p !== null)
}

// Listado publicado del idioma pedido, ordenado por fecha (desc).
export function getPublishedPosts(lang: Locale = "es"): BlogPost[] {
  return readAllPosts(lang)
    .filter((p) => p.isPublished)
    .sort((a, b) => (a.publishedOn < b.publishedOn ? 1 : -1))
}

export function getPostSlugs(lang: Locale = "es"): string[] {
  return getPublishedPosts(lang).map((p) => p.slug)
}

export function getPostBySlug(
  slug: string,
  lang: Locale = "es"
): BlogPost | null {
  const post = readAllPosts(lang).find((p) => p.slug === slug)
  return post && post.isPublished ? post : null
}

// Idiomas en los que ESE slug existe publicado. Alimenta el hreflang del post:
// declarar la gemela de un idioma que no existe apunta a un 404 y hace que
// Google descarte el clúster hreflang entero (ver lib/seo.ts).
export function localesWithPost(slug: string): Locale[] {
  return locales.filter((lang) => getPostBySlug(slug, lang) !== null)
}

// Encabezados H2/H3 del cuerpo para la tabla de contenidos. Los ids coinciden
// con los que genera rehype-slug al renderizar el MDX.
export function getHeadings(content: string): BlogHeading[] {
  const headings: BlogHeading[] = []
  // Misma instancia y orden que rehype-slug para que los ids (y el dedupe de
  // encabezados repetidos) coincidan exactamente con el HTML renderizado.
  const slugger = new GithubSlugger()
  let inFence = false

  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/)
    if (!match?.[1] || !match[2]) continue

    const text = match[2].replace(/[*_`]/g, "").trim()
    headings.push({ depth: match[1].length, text, id: slugger.slug(text) })
  }

  return headings
}

export function formatDate(iso: string, lang: Locale = "es"): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  // La fecha es YYYY-MM-DD (medianoche UTC). Formateamos en UTC para que el día
  // mostrado coincida con el ISO sin importar la zona horaria del servidor.
  return date.toLocaleDateString(lang === "es" ? "es-AR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}
