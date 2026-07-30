// Contrato de traducción del sitio público (landing, pricing, blog, auth,
// header/footer). `es.ts` y `en.ts` implementan este mismo tipo `Dict`, así que
// si falta una clave en cualquiera de los dos el typecheck falla y los idiomas
// quedan sincronizados a la fuerza.
//
// Ruteo: el español vive en la raíz (`/`, `/pricing`, …) y el inglés bajo `/en`.
// Los helpers de abajo son la única fuente de verdad de esa convención.

export type Locale = "es" | "en"

export const locales: Locale[] = ["es", "en"]
export const defaultLocale: Locale = "es"

export type FaqItem = { q: string; a: string }
export type PainItem = { icon: string; title: string; body: string }
export type Step = { title: string; body: string }
export type Plan = {
  name: string
  price: string
  period: string
  description: string
  featured: boolean
  badge: string | null
  cta: string
  features: string[]
}
export type ComparisonRow = {
  feature: string
  resender: string | boolean
  manychat: string | boolean
}

// Una entrada del índice de /llms.txt. Se renderiza como el spec de llmstxt.org
// manda: `- [label](url): detail`.
export type LlmsEntry = { label: string; detail: string }

export type Dict = {
  nav: {
    pricing: string
    blog: string
    docs: string
    login: string
    getStarted: string
    menu: string
    openMenu: string
    // aria-label del logo, que enlaza a la home del idioma actual.
    home: string
  }
  hero: {
    eyebrow: string
    title: string
    titleAccent: string
    subtitle: string
    ctaPrimary: string
    ctaSecondary: string
  }
  flowMock: {
    live: string
    in: { meta: string; text: string }
    hook: { meta: string; text: string }
    out: { meta: string; text: string }
  }
  pain: {
    kicker: string
    title: string
    subtitle: string
    questions: string[]
    items: PainItem[]
  }
  howItWorks: {
    kicker: string
    title: string
    subtitle: string
    stepLabel: string
    steps: Step[]
  }
  quickstart: {
    kicker: string
    title: string
    subtitle: string
    filename: string
    // Texto de ejemplo que va en el body `text` de los snippets de código.
    textSample: string
    copy: string
    copied: string
  }
  pricingPreview: { kicker: string; title: string; subtitle: string; cta: string }
  faq: { kicker: string; title: string; items: FaqItem[] }
  finalCta: { title: string; subtitle: string; cta: string }
  pricing: {
    kicker: string
    title: string
    subtitle: string
    intro: string[]
    plans: Plan[]
  }
  comparison: {
    kicker: string
    title: string
    subtitle: string
    yes: string
    no: string
    headers: { feature: string; resender: string; manychat: string }
    rows: ComparisonRow[]
  }
  // Página /vs-manychat. Reutiliza `comparison` (la tabla) y le suma el
  // contenido propio que necesita para rankear por sí sola.
  vsManychat: {
    kicker: string
    title: string
    subtitle: string
    intro: string[]
    verdict: { title: string; items: { when: string; pick: string }[] }
    faq: { title: string; items: FaqItem[] }
    cta: { title: string; subtitle: string; cta: string }
    metaTitle: string
    metaDescription: string
  }
  pricingFaq: { kicker: string; title: string; items: FaqItem[] }
  pricingCta: { title: string; subtitle: string; cta: string }
  blog: {
    metaTitle: string
    metaDescription: string
    title: string
    // Párrafo único bajo el H1. Antes había además un `subtitle` como lead; se
    // quitó para no decir dos veces lo mismo arriba del listado.
    intro: string
    empty: string
    back: string
    reading: { title: string; subtitle: string; cta: string }
    // Etiqueta singular de la categoría (badge del post). La clave interna
    // (`actualizacion`) no cambia; solo su etiqueta visible.
    categories: { tutorial: string; actualizacion: string }
    // Etiqueta plural para los botones de filtro del listado.
    filters: { tutorial: string; actualizacion: string }
    filterGroupLabel: string
    emptyCategory: string
    tocNavLabel: string
    tocTitle: string
    rssTitle: string
    rssDescription: string
  }
  auth: {
    login: { eyebrow: string; title: string; subtitle: string }
    register: { eyebrow: string; title: string; subtitle: string }
    passwordChanged: string
    form: {
      email: string
      password: string
      emailPlaceholder: string
      passwordPlaceholder: string
      passwordHint: string
      processing: string
      signIn: string
      createAccount: string
      noAccount: string
      haveAccount: string
      signUp: string
      signInAction: string
    }
    errors: {
      invalidCredentials: string
      duplicateEmail: string
      invalidInput: string
      createdNoSignin: string
    }
  }
  footer: {
    tagline: string
    columns: { product: string; legal: string; contact: string }
    links: {
      pricing: string
      vsManychat: string
      blog: string
      docs: string
      privacy: string
      terms: string
      dataDeletion: string
    }
  }
  meta: {
    home: {
      title: string
      description: string
      ogTitle: string
      ogDescription: string
    }
    pricing: {
      title: string
      description: string
      ogTitle: string
      ogDescription: string
    }
  }
  // Copy de /llms.txt y /llms-full.txt (spec: https://llmstxt.org/). Vive en el
  // diccionario y no en `lib/llms-txt.ts` para que el contrato `Dict` fuerce la
  // paridad ES/EN igual que el resto del sitio. Las URLs y los títulos de las
  // páginas NO se repiten acá: salen de `site-config`, `localePath` y del copy
  // que ya existe (`pricing.title`, `blog.title`, …).
  llms: {
    // Blockquote que va justo debajo del H1: lo mínimo para entender el resto
    // del archivo sin abrir ninguna URL.
    summary: string
    // Párrafos entre el blockquote y el primer H2. El spec solo admite acá
    // secciones "de cualquier tipo excepto encabezados".
    context: string[]
    // Títulos de las secciones H2 del índice.
    sections: {
      product: string
      docs: string
      blog: string
      legal: string
      // El spec matchea el literal "Optional" para saber qué se puede saltear
      // si hace falta menos contexto: no se traduce, ni siquiera en español.
      optional: "Optional"
    }
    entries: {
      home: LlmsEntry
      pricing: LlmsEntry
      vsManychat: LlmsEntry
      blog: LlmsEntry
      docs: LlmsEntry
      privacy: LlmsEntry
      terms: LlmsEntry
      dataDeletion: LlmsEntry
      full: LlmsEntry
      otherLocale: LlmsEntry
      rss: LlmsEntry
    }
    // /llms-full.txt: el volcado del contenido completo.
    fullFile: {
      title: string
      // Nota de contexto; `{date}` se reemplaza por la fecha de actualización.
      note: string
      // Encabezado de la lista de posts dentro del volcado.
      postsTitle: string
      // Etiquetas de los campos que no salen de una sección con título propio.
      sourceLabel: string
      publishedLabel: string
      plansTitle: string
      comparisonTitle: string
    }
  }
}

// Prefija una ruta interna con el idioma. Las rutas NO localizadas (docs,
// legales) no deben pasar por acá.
export function localePath(path: string, locale: Locale): string {
  if (locale === "en") return path === "/" ? "/en" : `/en${path}`
  return path
}

export function localeFromPathname(pathname: string): Locale {
  return pathname === "/en" || pathname.startsWith("/en/") ? "en" : "es"
}

// Rutas que existen en los dos idiomas. Todo lo demás (docs, páginas legales,
// waitlist, billing y la app logueada) vive solo en la raíz.
const LOCALIZED_ROUTES = [
  "/pricing",
  "/vs-manychat",
  "/blog",
  "/login",
  "/register",
]

// Quita el prefijo /en de un pathname y devuelve la ruta "base" (sin idioma).
function stripLocale(pathname: string): string {
  const stripped = pathname.replace(/^\/en(?=\/|$)/, "")
  return stripped === "" ? "/" : stripped
}

// ¿La ruta tiene gemela en el otro idioma? El header (y por lo tanto el switch)
// también se renderiza en páginas fuera del alcance de i18n; sin esta guarda,
// cambiar de idioma desde /privacy llevaría a /en/privacy, que es un 404.
export function hasLocaleTwin(pathname: string): boolean {
  const base = stripLocale(pathname)
  if (base === "/") return true
  return LOCALIZED_ROUTES.some(
    (route) => base === route || base.startsWith(`${route}/`)
  )
}

// Ruta equivalente en el otro idioma, para el switch ES/EN. Si la ruta actual no
// existe en el idioma destino, cae a la home de ese idioma.
export function switchLocalePath(pathname: string, target: Locale): string {
  if (!hasLocaleTwin(pathname)) return localePath("/", target)

  if (target === "en") {
    if (pathname === "/en" || pathname.startsWith("/en/")) return pathname
    return pathname === "/" ? "/en" : `/en${pathname}`
  }
  return stripLocale(pathname)
}
