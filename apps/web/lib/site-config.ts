// Origen público del sitio. Fuente única de verdad para `metadataBase`, el
// sitemap, el robots.txt, los canonicals de `lib/seo.ts` y el RSS del blog —
// antes estaba hardcodeado por separado en cada uno de esos archivos.
//
// El fallback NO es opcional: `robots.ts` y `sitemap.ts` interpolan este valor,
// así que sin él un build sin la variable emitiría `undefined/sitemap.xml`.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://resender.dev"

export const SITE_NAME = "Resender"

// Empresa que opera Resender (coincide con lo declarado en /privacy y /terms).
export const SITE_LEGAL_NAME = "AI Beat"

export const SITE_CONTACT_EMAIL = "info@resender.dev"
export const SITE_CONTACT_EMAIL_HREF = `mailto:${SITE_CONTACT_EMAIL}`

// Docs: viven en su propio repo y se publican en este subdominio. El sitio de
// marketing solo enlaza hacia allá (ver el redirect 301 en next.config.ts).
export const DOCS_URL = "https://docs.resender.dev/"

// Fecha (YYYY-MM-DD) de la última vez que cambió el copy de las páginas fijas.
// Las páginas fijas no tienen fecha de contenido propia: usar `new Date()` hacía
// que su `lastmod` cambiara en CADA deploy sin cambiar el contenido — ruido que
// enseña a Google a desconfiar de la señal. Se sube A MANO cuando el copy cambia
// de verdad. La consumen el sitemap y el encabezado de /llms-full.txt, así que
// las dos declaran lo mismo.
export const STATIC_CONTENT_UPDATED_AT = "2026-08-03"

// Invitación de Discord. Si alguna vez vuelve a ser null, el footer oculta la
// entrada en lugar de dejar un link muerto en todas las páginas del sitio.
export const DISCORD_INVITE_URL: string | null = "https://discord.gg/kKWUejyjVj"

// URL absoluta de una ruta interna. La home queda SIN barra final, que es como
// Next resuelve `alternates.canonical: "/"` contra `metadataBase`. Canonical,
// sitemap, hreflang y JSON-LD tienen que coincidir carácter por carácter: una
// misma página anunciada con y sin barra son dos URLs distintas.
export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`
}
