import { describe, expect, it } from "vitest"

import {
  getHeadings,
  parseCategoryLabel,
  parsePost,
  parseSpanishDate,
} from "./blog"

describe("parseSpanishDate", () => {
  it("parsea fecha en español", () => {
    expect(parseSpanishDate("23 de julio de 2026")).toBe("2026-07-23")
    expect(parseSpanishDate("1 de enero de 2027")).toBe("2027-01-01")
    expect(parseSpanishDate("5 de setiembre de 2025")).toBe("2025-09-05")
  })

  it("parsea ISO y dd/mm/yyyy", () => {
    expect(parseSpanishDate("2026-07-23")).toBe("2026-07-23")
    expect(parseSpanishDate("23/07/2026")).toBe("2026-07-23")
    expect(parseSpanishDate("7/3/2026")).toBe("2026-03-07")
  })

  it("devuelve null si no es una fecha", () => {
    expect(parseSpanishDate("hola mundo")).toBeNull()
    expect(parseSpanishDate("importante")).toBeNull()
  })
})

describe("parseCategoryLabel", () => {
  it("mapea etiquetas con y sin acento / plural", () => {
    expect(parseCategoryLabel("Tutorial")).toBe("tutorial")
    expect(parseCategoryLabel("Tutoriales")).toBe("tutorial")
    expect(parseCategoryLabel("Actualización")).toBe("actualizacion")
    expect(parseCategoryLabel("actualizaciones")).toBe("actualizacion")
  })

  it("devuelve null si no es una categoría conocida", () => {
    expect(parseCategoryLabel("Novedad")).toBeNull()
    expect(parseCategoryLabel("23 de julio de 2026")).toBeNull()
  })
})

describe("getHeadings", () => {
  it("extrae H2/H3 e ignora H1 y bloques de código", () => {
    const content = [
      "# Título principal",
      "",
      "Intro.",
      "",
      "## Primera sección",
      "texto",
      "### Subsección",
      "```js",
      "## esto es código, no un heading",
      "```",
      "## Segunda sección",
    ].join("\n")

    // Los ids conservan acentos, igual que rehype-slug (github-slugger).
    expect(getHeadings(content)).toEqual([
      { depth: 2, text: "Primera sección", id: "primera-sección" },
      { depth: 3, text: "Subsección", id: "subsección" },
      { depth: 2, text: "Segunda sección", id: "segunda-sección" },
    ])
  })

  it("deduplica encabezados repetidos como rehype-slug", () => {
    const content = ["## Notas", "## Notas"].join("\n")
    expect(getHeadings(content).map((h) => h.id)).toEqual(["notas", "notas-1"])
  })
})

describe("parsePost — markdown puro (sin frontmatter)", () => {
  const raw = [
    "# Límites para agentes de IA",
    "",
    "*23 de julio de 2026*",
    "",
    "Primer párrafo que sirve de resumen.",
    "",
    "## Una sección",
    "Contenido.",
  ].join("\n")

  const post = parsePost(raw, "limites-para-agentes-de-ia")!

  it("deriva título, slug, fecha y abstract del cuerpo", () => {
    expect(post.title).toBe("Límites para agentes de IA")
    expect(post.slug).toBe("limites-para-agentes-de-ia")
    expect(post.publishedOn).toBe("2026-07-23")
    expect(post.abstract).toBe("Primer párrafo que sirve de resumen.")
  })

  it("quita título y fecha del contenido pero conserva el cuerpo", () => {
    expect(post.content).not.toContain("# Límites")
    expect(post.content).not.toContain("*23 de julio")
    expect(post.content).toContain("## Una sección")
    expect(post.content).toContain("Primer párrafo")
  })

  it("publica por defecto y no fuerza categoría/autor", () => {
    expect(post.isPublished).toBe(true)
    expect(post.category).toBeUndefined()
    expect(post.author).toBeUndefined()
    expect(post.lang).toBe("es")
  })
})

describe("parsePost — categoría en la línea de la fecha", () => {
  it("lee 'Tutorial · fecha' y quita la línea del cuerpo", () => {
    const raw = [
      "# Título",
      "",
      "*Tutorial · 23 de julio de 2026*",
      "",
      "Cuerpo.",
    ].join("\n")
    const post = parsePost(raw, "x")!
    expect(post.category).toBe("tutorial")
    expect(post.publishedOn).toBe("2026-07-23")
    expect(post.content).not.toContain("Tutorial ·")
    expect(post.content).toContain("Cuerpo.")
  })

  it("acepta el orden inverso y el separador |", () => {
    const raw = ["# T", "", "*23/07/2026 | Actualización*", "", "Cuerpo."].join(
      "\n"
    )
    const post = parsePost(raw, "x")!
    expect(post.category).toBe("actualizacion")
    expect(post.publishedOn).toBe("2026-07-23")
  })

  it("sin categoría sigue funcionando (solo fecha)", () => {
    const raw = ["# T", "", "*23 de julio de 2026*", "", "Cuerpo."].join("\n")
    const post = parsePost(raw, "x")!
    expect(post.category).toBeUndefined()
    expect(post.publishedOn).toBe("2026-07-23")
  })
})

describe("parsePost — retrocompatibilidad con frontmatter YAML", () => {
  const raw = [
    "---",
    'title: "Lanzamos Resender"',
    'abstract: "Resumen del frontmatter."',
    'category: "actualizacion"',
    "isPublished: true",
    "publishedOn: 2026-07-15",
    'author: "Equipo Resender"',
    'lang: "es"',
    "---",
    "",
    "Cuerpo del post.",
  ].join("\n")

  const post = parsePost(raw, "lanzamos-resender")!

  it("usa el frontmatter tal cual", () => {
    expect(post.title).toBe("Lanzamos Resender")
    expect(post.abstract).toBe("Resumen del frontmatter.")
    expect(post.category).toBe("actualizacion")
    expect(post.publishedOn).toBe("2026-07-15")
    expect(post.author).toBe("Equipo Resender")
    expect(post.content.trim()).toBe("Cuerpo del post.")
  })
})

describe("parsePost — sin título", () => {
  it("devuelve null si no hay título ni frontmatter", () => {
    expect(parsePost("Solo texto, sin encabezado.", "x")).toBeNull()
  })
})
