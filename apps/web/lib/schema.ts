import {
  getDictionary,
  localePath,
  type FaqItem,
  type Locale,
  type Plan,
} from "@/content/i18n"
import {
  SITE_CONTACT_EMAIL,
  SITE_LEGAL_NAME,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
} from "@/lib/site-config"

// Constructores de JSON-LD. Todo el dato sale del diccionario o del loader del
// blog, así que el marcado no puede desincronizarse del contenido visible —
// requisito de Google: el structured data debe describir lo que se ve.
//
// Los `@id` son absolutos y estables para que los nodos se referencien entre sí
// (Organization ← WebSite ← BlogPosting) en vez de repetirse sueltos.

type JsonLdNode = Record<string, unknown>

const ORG_ID = `${SITE_URL}/#organization`
const WEBSITE_ID = `${SITE_URL}/#website`

function ogLanguage(lang: Locale) {
  return lang === "es" ? "es" : "en"
}

export function organizationSchema(): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    legalName: SITE_LEGAL_NAME,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon.png`,
    email: SITE_CONTACT_EMAIL,
    description:
      "API relay que recibe mensajes de Facebook en tu webhook y los responde por API.",
  }
}

export function webSiteSchema(lang: Locale): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: absoluteUrl(localePath("/", lang)),
    inLanguage: ogLanguage(lang),
    publisher: { "@id": ORG_ID },
  }
}

export function faqSchema(items: readonly FaqItem[], lang: Locale): JsonLdNode {
  return {
    "@type": "FAQPage",
    inLanguage: ogLanguage(lang),
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  }
}

// "$15" → "15". Los precios del diccionario son strings con símbolo porque se
// renderizan tal cual; Schema.org exige el valor numérico por separado.
function numericPrice(price: string): string {
  return price.replace(/[^0-9.]/g, "")
}

export function softwareApplicationSchema(
  plans: readonly Plan[],
  lang: Locale
): JsonLdNode {
  return {
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    url: absoluteUrl(localePath("/pricing", lang)),
    inLanguage: ogLanguage(lang),
    publisher: { "@id": ORG_ID },
    offers: plans.map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      price: numericPrice(plan.price),
      priceCurrency: "USD",
      category: "SaaS subscription",
      url: absoluteUrl(localePath("/pricing", lang)),
      availability: "https://schema.org/InStock",
    })),
  }
}

export function blogPostingSchema({
  title,
  description,
  slug,
  publishedOn,
  updatedOn,
  author,
  lang,
}: {
  title: string
  description: string
  slug: string
  publishedOn: string
  updatedOn?: string
  author?: string
  lang: Locale
}): JsonLdNode {
  const url = absoluteUrl(localePath(`/blog/${slug}`, lang))
  return {
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    headline: title,
    description,
    url,
    mainEntityOfPage: url,
    inLanguage: ogLanguage(lang),
    datePublished: publishedOn,
    dateModified: updatedOn ?? publishedOn,
    image: `${url}/opengraph-image`,
    author: author
      ? { "@type": "Person", name: author }
      : { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    isPartOf: { "@id": WEBSITE_ID },
  }
}

export function breadcrumbSchema(
  trail: readonly { name: string; path: string }[],
  lang: Locale
): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(localePath(crumb.path, lang)),
    })),
  }
}

/**
 * Empaqueta varios nodos en un solo `@graph`. Un único `<script>` por página
 * en vez de uno por schema: es lo que Google recomienda y permite que los
 * nodos se referencien por `@id`.
 */
export function schemaGraph(...nodes: JsonLdNode[]) {
  return { "@context": "https://schema.org", "@graph": nodes }
}

/** Grafo base que va en todas las páginas de marketing. */
export function baseGraph(lang: Locale) {
  return [organizationSchema(), webSiteSchema(lang)]
}

export function landingGraph(lang: Locale) {
  const dict = getDictionary(lang)
  return schemaGraph(
    ...baseGraph(lang),
    faqSchema(dict.faq.items, lang),
    softwareApplicationSchema(dict.pricing.plans, lang)
  )
}
