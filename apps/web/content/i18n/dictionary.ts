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
export type FeatureItem = {
  icon: string
  title: string
  body: string
  hidden?: boolean
}
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
    // Texto de ejemplo que va en el body `reply` de los snippets de código.
    replySample: string
  }
  features: {
    kicker: string
    title: string
    subtitle: string
    items: FeatureItem[]
  }
  pricingPreview: { kicker: string; title: string; subtitle: string; cta: string }
  about: { title: string; body: string[] }
  faq: { kicker: string; title: string; items: FaqItem[] }
  finalCta: { title: string; subtitle: string; cta: string }
  pricing: { kicker: string; title: string; subtitle: string; plans: Plan[] }
  comparison: {
    kicker: string
    title: string
    subtitle: string
    yes: string
    no: string
    headers: { feature: string; resender: string; manychat: string }
    rows: ComparisonRow[]
  }
  pricingFaq: { kicker: string; title: string; items: FaqItem[] }
  pricingCta: { title: string; subtitle: string; cta: string }
  blog: {
    metaTitle: string
    metaDescription: string
    title: string
    subtitle: string
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
    login: { title: string; subtitle: string }
    register: { title: string; subtitle: string }
    passwordChanged: string
    form: {
      email: string
      password: string
      emailPlaceholder: string
      passwordPlaceholder: string
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
const LOCALIZED_ROUTES = ["/pricing", "/blog", "/login", "/register"]

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
