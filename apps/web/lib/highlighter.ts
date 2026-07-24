import { createBundledHighlighter, createSingletonShorthands } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

// Bundle fine-grained de shiki con el motor JavaScript: Workers prohíbe
// compilar WASM en runtime, así que el motor Oniguruma (default del bundle
// completo) revienta con "Wasm code generation disallowed by embedder".
// Solo registramos los lenguajes/temas que usan la landing y el blog; si un
// post usa un lenguaje nuevo hay que agregarlo aquí.
export const createHighlighter = createBundledHighlighter({
  langs: {
    bash: () => import("@shikijs/langs/bash"),
    javascript: () => import("@shikijs/langs/javascript"),
    python: () => import("@shikijs/langs/python"),
    json: () => import("@shikijs/langs/json"),
  },
  themes: {
    "github-light": () => import("@shikijs/themes/github-light"),
    "github-dark": () => import("@shikijs/themes/github-dark"),
  },
  engine: () => createJavaScriptRegexEngine(),
})

export const { codeToHtml } = createSingletonShorthands(createHighlighter)
