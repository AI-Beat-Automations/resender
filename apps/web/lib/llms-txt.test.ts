import { describe, expect, it } from "vitest"

import { buildLlmsFullTxt, buildLlmsTxt } from "./llms-txt"
import { getPublishedPosts } from "./blog"
import { locales, type Locale } from "@/content/i18n"

// El spec de llmstxt.org fija una estructura muy concreta y silenciosa: si se
// rompe, el archivo sigue sirviéndose con 200 y nadie se entera. Estos tests son
// el único chequeo que tenemos de que la forma sigue siendo válida.

const LIST_ITEM = /^- \[[^\]]+\]\(https:\/\/[^)\s]+\)(: .+)?$/

function lines(text: string): string[] {
  return text.split("\n")
}

function headings(text: string): string[] {
  let inFence = false
  return lines(text).filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return false
    }
    return !inFence && /^#{1,6}\s/.test(line)
  })
}

describe.each(locales)("buildLlmsTxt(%s)", (lang: Locale) => {
  const txt = buildLlmsTxt(lang)
  const all = lines(txt)

  it("arranca con un único H1 y el blockquote justo debajo", () => {
    expect(all[0]).toMatch(/^# .+/)
    expect(all[1]).toBe("")
    expect(all[2]).toMatch(/^> .+/)
    expect(headings(txt).filter((h) => h.startsWith("# "))).toHaveLength(1)
  })

  it("no mete encabezados entre el blockquote y el primer H2", () => {
    const firstH2 = all.findIndex((line) => line.startsWith("## "))
    expect(firstH2).toBeGreaterThan(2)
    const between = all.slice(3, firstH2)
    expect(between.filter((line) => /^#{1,6}\s/.test(line))).toEqual([])
  })

  it("solo usa H1 y H2: el índice no anida secciones", () => {
    expect(headings(txt).filter((h) => /^#{3,6}\s/.test(h))).toEqual([])
  })

  it("cierra con la sección Optional, con ese literal exacto", () => {
    const h2s = headings(txt).filter((h) => h.startsWith("## "))
    expect(h2s.at(-1)).toBe("## Optional")
    expect(h2s.filter((h) => h === "## Optional")).toHaveLength(1)
  })

  it("escribe cada item como `- [nombre](url absoluta): detalle`", () => {
    const items = all.filter((line) => line.startsWith("-"))
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(item).toMatch(LIST_ITEM)
  })

  it("lista todos los posts publicados de su idioma", () => {
    const posts = getPublishedPosts(lang)
    expect(posts.length).toBeGreaterThan(0)
    for (const post of posts) {
      expect(txt).toContain(`/blog/${post.slug})`)
      expect(txt).toContain(`[${post.title}]`)
    }
  })

  it("apunta a las URLs de su propio idioma", () => {
    const own = lang === "es" ? "https://resender.dev/blog" : "https://resender.dev/en/blog"
    expect(txt).toContain(`(${own})`)
    if (lang === "es") {
      // El único /en admitido es el link cruzado al índice del otro idioma.
      expect(txt).toContain("(https://resender.dev/en/llms.txt)")
      expect(txt).not.toContain("(https://resender.dev/en/pricing)")
    } else {
      expect(txt).toContain("(https://resender.dev/llms.txt)")
      expect(txt).toContain("(https://resender.dev/en/pricing)")
    }
  })

  it("enlaza su volcado completo y las legales, que viven solo en la raíz", () => {
    const full =
      lang === "es"
        ? "https://resender.dev/llms-full.txt"
        : "https://resender.dev/en/llms-full.txt"
    expect(txt).toContain(`(${full})`)
    expect(txt).toContain("(https://resender.dev/privacy)")
  })

  it("termina en un solo salto de línea", () => {
    expect(txt.endsWith("\n")).toBe(true)
    expect(txt.endsWith("\n\n")).toBe(false)
  })
})

describe.each(locales)("buildLlmsFullTxt(%s)", (lang: Locale) => {
  const full = buildLlmsFullTxt(lang)

  it("arranca con un único H1 y su blockquote", () => {
    const all = lines(full)
    expect(all[0]).toMatch(/^# .+/)
    expect(all[2]).toMatch(/^> .+/)
    expect(headings(full).filter((h) => h.startsWith("# "))).toHaveLength(1)
  })

  it("resuelve los placeholders de la nota", () => {
    expect(full).not.toContain("{date}")
    expect(full).not.toContain("{index}")
    expect(full).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it("incluye el cuerpo completo de cada post, no solo el abstract", () => {
    for (const post of getPublishedPosts(lang)) {
      expect(full).toContain(`## ${post.title}`)
      // Un fragmento del final del artículo: si solo estuviera el resumen, no
      // aparecería.
      const tail = post.content.trim().split("\n").filter(Boolean).at(-1)
      expect(full).toContain((tail ?? "").slice(0, 40))
    }
  })

  it("baja un nivel los encabezados del post para no chocar con el H2 de página", () => {
    // El cuerpo de los posts usa H2/H3; dentro del volcado tienen que quedar en
    // H3 o más profundo.
    for (const post of getPublishedPosts(lang)) {
      const inner = headings(post.content).filter((h) => h.startsWith("## "))
      for (const heading of inner) expect(full).toContain(`#${heading}`)
    }
  })

  it("declara la URL fuente de cada página volcada", () => {
    const pricing =
      lang === "es"
        ? "https://resender.dev/pricing"
        : "https://resender.dev/en/pricing"
    expect(full).toContain(pricing)
    expect(full).toContain("$15")
  })
})
