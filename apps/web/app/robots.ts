import type { MetadataRoute } from "next"

import { SITE_URL } from "@/lib/site-config"

// Rutas sin valor de búsqueda: auth, checkout y la app logueada. Van con
// `noindex` en su metadata además de acá — el Disallow ahorra crawl budget,
// pero solo el meta robots saca del índice una URL ya indexada.
//
// `/waitlist` ya no está en la lista: dejó de ser la pantalla autenticada del
// gate de acceso y pasó a ser la lista de espera pública, indexable y en el
// sitemap (ADR 0007).
const PRIVATE_PATHS = [
  "/api/",
  "/login",
  "/register",
  "/en/login",
  "/en/register",
  "/billing",
  "/connections",
  "/inbox",
  "/settings",
]

// Crawlers de IA que RECUPERAN contenido para responder y citan la fuente:
// aparecer acá es tráfico y visibilidad de marca.
const AI_SEARCH_AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-User",
  "Claude-SearchBot",
  // Habilita el grounding de Gemini (que cita fuente). Ojo: las AI Overviews de
  // Google las gobierna Googlebot, no este agente.
  "Google-Extended",
]

// Crawlers que solo recolectan corpus de entrenamiento: no devuelven tráfico
// ni atribución.
const AI_TRAINING_AGENTS = [
  "GPTBot",
  "CCBot",
  "ClaudeBot",
  "Bytespider",
  "Amazonbot",
  "Applebot-Extended",
  "meta-externalagent",
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: AI_SEARCH_AGENTS, allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: AI_TRAINING_AGENTS, disallow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
