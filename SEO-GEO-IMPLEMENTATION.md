# SEO-GEO — Handoff de implementación (copy + i18n EN/ES)

> **Propósito.** Este documento describe **todo** el trabajo que se hizo en una rama `seo-geo` que
> había salido de un `main` **desactualizado**. En vez de reconciliar esa rama, la estrategia es:
> volver a `main`, `git pull`, crear una `seo-geo` nueva y **reimplementar desde acá**.
>
> Un agente debería poder leer este archivo y reproducir el resultado sin rehacer trabajo creativo
> (especialmente **el copy en inglés**, que está transcripto completo más abajo).

---

## 0. Contexto de git (leer antes de empezar)

La `seo-geo` anterior salió de `main = 4c89ddc` (PR #20, "sitio de marketing"). Pero el `main` real
del remoto ya había avanzado. En `main` actualizado **ya están mergeados**:

- **PR #21 — "Blog en Markdown, favicon e integración de PostHog"** (rama `blog`). ⚠️ **Reescribió el
  sistema de blog**: reemplazó los posts `.mdx` por `.md`, reescribió `lib/blog.ts` (~233 líneas),
  agregó `app/blog/blog-list.tsx`, `lib/blog.test.ts`, PostHog y favicons/iconos.
- **PR #22 — "migración a Cloudflare Workers con OpenNext"**. Cambia el runtime/deploy.

**Implicancia clave:** casi todo el trabajo de abajo (diccionarios, componentes de marketing,
header/footer, toggle ES/EN, auth, ruteo de landing/pricing) aplica **tal cual** sobre el `main`
nuevo, porque esos archivos vienen del PR #20 y no los tocó el PR #21. **La única parte que hay que
ADAPTAR es el blog** (Sección 6): la estructura de `lib/blog.ts`, las páginas de blog y los archivos
de posts en `main` nuevo son distintas a las que se describen acá. Tomar de este doc el **copy** y la
**intención de i18n del blog**, pero aplicarlos sobre la implementación nueva del blog, no sobre la
vieja.

---

## PARTE 1 — Correcciones de copy (sitio en español)

Estas correcciones venían del pedido original y aplican a **toda la web** (landing, pricing, blog,
docs). Ya quedan reflejadas en el diccionario ES final (Sección 8), pero se listan acá como "diff"
explícito.

### 1.1 Argentinismos → neutro (solo estas tres formas, respetando límite de palabra)

Reemplazar **solo** el imperativo/1ª persona exacto, **sin** tocar otras conjugaciones voseo
(`conectás`, `recibís`, `respondés`, `empezás`, `configurás`, etc. quedan igual):

| Antes | Después |
|---|---|
| `recibí` | `recibe` |
| `respondé` | `responde` |
| `conectá` | `conecta` |

Incluye variantes con mayúscula inicial (`Recibí`→`Recibe`, `Respondé`→`Responde`, `Conectá`→`Conecta`).
Aplica en landing, pricing, **blog** (posts + CTA) y metadatos SEO. ⚠️ Cuidado con no convertir
`conectás`→`conectas` por reemplazo ciego de substring.

### 1.2 Reemplazos de copy específicos (textos entregados por el usuario)

| Sección | Campo | Texto final |
|---|---|---|
| Hero | subtítulo | `Conecta tu página, apunta tu webhook y responde con un POST. Sin builders visuales ni features que no usás.` |
| Cómo funciona | **título** | `De cero a recibiendo mensajes en minutos` |
| Cómo funciona | subtítulo | *(vaciado)* — antes decía "…, no en días.", quedó duplicado con el nuevo título, así que se dejó `""` |
| Cómo funciona | paso 2 (body) | `Pegá la URL de tu webhook y Resender empieza a reenviarte los mensajes entrantes.` |
| Quickstart | subtítulo | `Un POST desde tu backend, desde n8n, desde donde sea.` |

### 1.3 Marca: "Meta" → "Facebook"

Reemplazar en **todo el copy visible** (landing, pricing, blog, docs, footer, metadatos SEO/OG).

**NO tocar** (rompería o sería incorrecto):
- Identificadores de código y rutas: `/api/meta/send`, `lib/meta.ts`, `features/connect-meta/…`,
  `import.meta.url`.
- Campos de la API / payloads: `metaPageId`, `metaMessageId`, la key `meta` de la respuesta JSON,
  placeholders `<meta-message-id>`.
- **Páginas legales** (`/privacy`, `/terms`, `/data-deletion`): nombran la entidad legal
  "Meta Platforms" — se dejan.
- Pantallas internas de la app logueada (connections/settings/etc.).
- En **docs**: cambiar solo la prosa de marca ("the Page's Facebook ID", "Facebook's raw passthrough
  response"), **manteniendo** los tokens de código (`meta`, `metaPageId`, rutas `api/meta/send`,
  referencias a archivos fuente).

### 1.4 Blog: "Actualizaciones" → "Novedades"

- Etiqueta visible de la categoría → **"Novedades"** (en `main` nuevo esto vive en la nueva
  implementación del blog; ubicar el label de categoría y cambiarlo).
- Prosa relacionada ("actualizaciones") en metadata del blog y RSS → "novedades".
- La **clave interna** de categoría (`actualizacion`) se mantiene; solo cambia la etiqueta visible.

### 1.5 Quitar "gratis"

Todos los CTA **"Empezá gratis"** → **"Empezá"** (hero, final CTA, pricing CTA, header ×2, CTA de post
de blog). Nota: `empezá` **no** se corrige (no estaba entre los tres argentinismos pedidos).

### 1.6 Decisión abierta (pendiente del usuario)

Quedó **una referencia relacionada sin resolver**: en el FAQ de pricing el ítem
**"¿Hay trial gratuito?"** (`gratuito`, no `gratis`). No se tocó. Decidir: sacarlo, dejarlo o
reformularlo. Si se saca, sacar el par Q/A completo del diccionario.

---

## PARTE 2 — Versión en inglés + switch ES/EN

### 2.1 Decisiones tomadas con el usuario

| Tema | Decisión |
|---|---|
| Mecanismo | **Ruteo por URL**. ES en la raíz (`/`), EN bajo `/en`. El switch navega entre versiones. |
| Blog | **Traducir todo el blog**, incluido el cuerpo de los posts. |
| Alcance | **Público + auth**: landing, pricing, blog, header/footer, **login/register**. |
| Excluido | **Docs** (sin switch), páginas legales, y la app logueada (product). |

### 2.2 Arquitectura general

- **Contrato de traducción**: un tipo `Dict` único. `es.ts` y `en.ts` lo implementan → si falta una
  clave en cualquiera, el typecheck falla (quedan sincronizados a la fuerza).
- Los componentes reciben `lang: Locale` como prop y resuelven el copy con `getDictionary(lang)`.
- Los enlaces se localizan con `localePath(path, lang)` (docs y legales **no** se localizan).
- Vistas compartidas parametrizadas por `lang`; cada ruta ES vive en su lugar original y su gemela EN
  bajo `app/en/...` renderiza la misma vista con `lang="en"`.
- `<html lang>`: el root layout queda `lang="es"`; en `/en` se corrige en cliente con `<HtmlLang>`.
  El SEO por idioma lo llevan los `hreflang` del metadata (server-side).

### 2.3 Archivos a CREAR (infra i18n)

Los siguientes son nuevos y su código va **completo** en la Sección 7:

| Archivo | Rol |
|---|---|
| `apps/web/content/i18n/dictionary.ts` | tipo `Dict`, `Locale`, `locales`, `defaultLocale`, y helpers `localePath` / `localeFromPathname` / `switchLocalePath` |
| `apps/web/content/i18n/index.ts` | reexporta helpers y expone `getDictionary(lang)` |
| `apps/web/content/i18n/es.ts` | diccionario español (Sección 8) |
| `apps/web/content/i18n/en.ts` | diccionario inglés (Sección 9) |
| `apps/web/components/language-toggle.tsx` | switch ES/EN, hermano del ThemeToggle |
| `apps/web/components/html-lang.tsx` | corrige `<html lang>` en cliente |
| `apps/web/features/marketing/views/landing-view.tsx` | landing compartida |
| `apps/web/features/marketing/views/pricing-view.tsx` | pricing compartida |
| `apps/web/features/marketing/views/blog-list-view.tsx` | listado de blog (⚠️ adaptar a blog nuevo) |
| `apps/web/features/marketing/views/blog-post-view.tsx` | post de blog (⚠️ adaptar a blog nuevo) |
| `apps/web/features/auth/ui/login-view.tsx` | vista login |
| `apps/web/features/auth/ui/register-view.tsx` | vista register |
| `apps/web/lib/blog-rss.ts` | builder de RSS por idioma (⚠️ adaptar a blog nuevo) |

Rutas `/en` nuevas: `app/en/page.tsx`, `app/en/pricing/page.tsx`, `app/en/blog/page.tsx`,
`app/en/blog/[slug]/page.tsx`, `app/en/blog/rss.xml/route.ts`, `app/en/login/page.tsx`,
`app/en/register/page.tsx`.

### 2.4 Archivos a MODIFICAR

- **Componentes de marketing** (`features/marketing/ui/`): `hero`, `flow-mock`, `pain-point`,
  `how-it-works`, `quickstart`, `pricing-preview`, `plan-cards`, `comparison-table`, `final-cta`.
  Patrón: sacar `import { dict } from "@/content/i18n/es"`; agregar prop `{ lang }: { lang: Locale }`
  y `const dict = getDictionary(lang)`; los kickers hardcodeados pasan a `dict.<sección>.kicker`;
  los enlaces `/register`,`/pricing`,`/login` pasan a `localePath("/…", lang)`.
- `components/site-header.tsx` y `components/site-footer.tsx`: agregar prop `lang`, nav/labels desde
  `dict.nav`/`dict.footer`, links con `localePath` (docs y legales quedan sin localizar), e insertar
  `<LanguageToggle />` **al lado de** `<ThemeToggle />` (desktop y mobile).
- **Todas** las páginas fuera de scope que usan header/footer (`app/privacy`, `app/terms`,
  `app/data-deletion`, `app/waitlist`, `app/docs/layout`, `app/billing`, `app/billing/success`):
  pasar `lang="es"` a `<SiteHeader/>` / `<SiteFooter/>` para que compile.
- `app/page.tsx`, `app/pricing/page.tsx`: renderizar la vista con `lang="es"` + metadata desde
  `dict.meta.*` + `alternates.languages` (hreflang, Sección 2.7).
- `features/auth/ui/auth-form.tsx`: prop `lang`, textos desde `dict.auth.form`, `<input hidden
  name="locale" value={lang}/>`, link con `localePath`.
- `features/auth/actions.ts`: leer `formData.get("locale")` y devolver los errores desde
  `getDictionary(locale).auth.errors` (código en Sección 7.5).
- `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`: renderizar las vistas con `lang="es"`.
- `app/sitemap.ts`: incluir rutas ES y EN (Sección 2.7).

### 2.5 Switch ES/EN

Componente `LanguageToggle` (código completo en 7.3). Es cliente, deriva el idioma del `pathname`
(`/en` → en, resto → es) y navega a la ruta equivalente con `switchLocalePath`. Se ubica **al lado
del switch día/noche** en el header, mismo look (dos labels `ES`/`EN` flanqueando un `Switch`).

### 2.6 Blog por idioma (intención — adaptar a `main` nuevo)

En la implementación de esta rama: posts en subdirectorios `content/blog/es/` y `content/blog/en/`,
**mismo slug** en ambos idiomas (para que el toggle no caiga en 404), `lib/blog.ts` recibe `lang`, y
RSS por idioma (`/blog/rss.xml` y `/en/blog/rss.xml`). En `main` nuevo el blog es distinto → **aplicar
la misma idea** (separar contenido por idioma, mismo slug, loader con `lang`) sobre la estructura que
exista, y volcar el copy EN de los posts (Sección 10).

### 2.7 SEO

- Cada página exporta `alternates.languages` con `es`, `en` y `x-default`, más `openGraph.locale`
  (`es_AR` / `en_US`). Ej. home ES:
  ```ts
  alternates: { canonical: "/", languages: { es: "/", en: "/en", "x-default": "/" } }
  ```
  Pricing: `{ es: "/pricing", en: "/en/pricing", "x-default": "/pricing" }`. Blog list y post:
  análogo con `/blog` y `/blog/${slug}`.
- `sitemap.ts`: rutas localizadas (`""`, `/pricing`, `/blog`) en raíz **y** bajo `/en`; rutas no
  localizadas (`/docs`, `/privacy`, `/terms`, `/data-deletion`) solo en raíz; posts ES y EN.

---

## PARTE 3 — Verificación

Al terminar debe pasar:
```bash
npx tsc --noEmit      # sin errores
npx vitest run        # toda la suite verde
npx next build        # genera / , /en , /pricing , /en/pricing , /blog , /en/blog ,
                      # /blog/[slug] , /en/blog/[slug] , /login , /register , /en/login , /en/register
```

---

## SECCIÓN 7 — Código de los archivos de infraestructura (copiar tal cual)

### 7.1 `content/i18n/dictionary.ts`

```ts
export type Locale = "es" | "en"

export const locales: Locale[] = ["es", "en"]
export const defaultLocale: Locale = "es"

export type FaqItem = { q: string; a: string }
export type PainItem = { icon: string; title: string; body: string }
export type Step = { title: string; body: string }
export type FeatureItem = { icon: string; title: string; body: string; hidden?: boolean }
export type Plan = {
  name: string; price: string; period: string; description: string
  featured: boolean; badge: string | null; cta: string; features: string[]
}
export type ComparisonRow = {
  feature: string; resender: string | boolean; manychat: string | boolean
}

export type Dict = {
  nav: { pricing: string; blog: string; docs: string; login: string; getStarted: string; menu: string; openMenu: string }
  hero: { eyebrow: string; title: string; titleAccent: string; subtitle: string; ctaPrimary: string; ctaSecondary: string }
  flowMock: { live: string; in: { meta: string; text: string }; hook: { meta: string; text: string }; out: { meta: string; text: string } }
  pain: { kicker: string; title: string; subtitle: string; questions: string[]; items: PainItem[] }
  howItWorks: { kicker: string; title: string; subtitle: string; stepLabel: string; steps: Step[] }
  quickstart: { kicker: string; title: string; subtitle: string; filename: string }
  features: { kicker: string; title: string; subtitle: string; items: FeatureItem[] }
  pricingPreview: { kicker: string; title: string; subtitle: string; cta: string }
  about: { title: string; body: string[] }
  faq: { kicker: string; title: string; items: FaqItem[] }
  finalCta: { title: string; subtitle: string; cta: string }
  pricing: { kicker: string; title: string; subtitle: string; plans: Plan[] }
  comparison: { kicker: string; title: string; subtitle: string; yes: string; no: string; headers: { feature: string; resender: string; manychat: string }; rows: ComparisonRow[] }
  pricingFaq: { kicker: string; title: string; items: FaqItem[] }
  pricingCta: { title: string; subtitle: string; cta: string }
  blog: { metaTitle: string; metaDescription: string; title: string; subtitle: string; empty: string; back: string; reading: { title: string; subtitle: string; cta: string }; categories: { tutorial: string; actualizacion: string }; rssTitle: string; rssDescription: string }
  auth: {
    login: { title: string; subtitle: string }
    register: { title: string; subtitle: string }
    passwordChanged: string
    form: { email: string; password: string; emailPlaceholder: string; passwordPlaceholder: string; processing: string; signIn: string; createAccount: string; noAccount: string; haveAccount: string; signUp: string; signInAction: string }
    errors: { invalidCredentials: string; duplicateEmail: string; invalidInput: string; createdNoSignin: string }
  }
  footer: { tagline: string; columns: { product: string; legal: string; contact: string }; links: { pricing: string; blog: string; docs: string; privacy: string; terms: string; dataDeletion: string } }
  meta: { home: { title: string; description: string; ogTitle: string; ogDescription: string }; pricing: { title: string; description: string; ogTitle: string; ogDescription: string } }
}

export function localePath(path: string, locale: Locale): string {
  if (locale === "en") return path === "/" ? "/en" : `/en${path}`
  return path
}

export function localeFromPathname(pathname: string): Locale {
  return pathname === "/en" || pathname.startsWith("/en/") ? "en" : "es"
}

export function switchLocalePath(pathname: string, target: Locale): string {
  if (target === "en") {
    if (pathname === "/en" || pathname.startsWith("/en/")) return pathname
    return pathname === "/" ? "/en" : `/en${pathname}`
  }
  const stripped = pathname.replace(/^\/en(?=\/|$)/, "")
  return stripped === "" ? "/" : stripped
}
```

### 7.2 `content/i18n/index.ts`

```ts
import type { Dict, Locale } from "./dictionary"
import { es } from "./es"
import { en } from "./en"

export type { Dict, Locale }
export { locales, defaultLocale, localePath, localeFromPathname, switchLocalePath } from "./dictionary"

const dictionaries: Record<Locale, Dict> = { es, en }

export function getDictionary(locale: Locale): Dict {
  return dictionaries[locale]
}
```

### 7.3 `components/language-toggle.tsx`

```tsx
"use client"

import { usePathname, useRouter } from "next/navigation"
import { cn } from "@workspace/ui/lib/utils"
import { Switch } from "@workspace/ui/components/switch"
import { localeFromPathname, switchLocalePath } from "@/content/i18n"

export function LanguageToggle() {
  const pathname = usePathname()
  const router = useRouter()
  const isEn = localeFromPathname(pathname) === "en"

  return (
    <label className="flex items-center gap-2" title="Language · Idioma">
      <span className={cn("font-mono text-xs", isEn ? "text-muted-foreground" : "text-foreground")} aria-hidden>ES</span>
      <Switch
        checked={isEn}
        onCheckedChange={(checked) => router.push(switchLocalePath(pathname, checked ? "en" : "es"))}
        aria-label="Switch language / Cambiar idioma"
      />
      <span className={cn("font-mono text-xs", isEn ? "text-foreground" : "text-muted-foreground")} aria-hidden>EN</span>
    </label>
  )
}
```

### 7.4 `components/html-lang.tsx`

```tsx
"use client"

import * as React from "react"

export function HtmlLang({ lang }: { lang: string }) {
  React.useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  return null
}
```

### 7.5 `features/auth/actions.ts` — errores localizados

Agregar el helper y usarlo en ambos actions:
```ts
import { getDictionary, type Locale } from "@/content/i18n"

function authErrors(formData: FormData) {
  const raw = formData.get("locale")
  const locale: Locale = raw === "en" ? "en" : "es"
  return getDictionary(locale).auth.errors
}
```
En `loginAction`: `const errors = authErrors(formData)` y devolver `errors.invalidCredentials`.
En `registerAction`: `errors.duplicateEmail`, `errors.invalidInput`, `errors.createdNoSignin`.

### 7.6 `features/auth/ui/auth-form.tsx` — cambios clave

Prop nueva `lang: Locale`. `const t = getDictionary(lang).auth.form`. Dentro del `<form>`:
`<input type="hidden" name="locale" value={lang} />`. Labels/placeholder/botón/link desde `t`:
- submit: `pending ? t.processing : isLogin ? t.signIn : t.createAccount`
- prompt: `isLogin ? t.noAccount : t.haveAccount`
- link: `href={localePath(isLogin ? "/register" : "/login", lang)}`, label `isLogin ? t.signUp : t.signInAction`

### 7.7 Ejemplo del patrón en un componente (`hero.tsx`)

Referencia de cómo queda cualquier componente de marketing tras el refactor:
```tsx
import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { FlowMock } from "@/features/marketing/ui/flow-mock"
import { Typewriter } from "@/features/marketing/ui/typewriter"
import { getDictionary, localePath, type Locale } from "@/content/i18n"

export function Hero({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)
  // …markup igual, con dict.hero.* …
  // CTA primario: <Link href={localePath("/register", lang)}>{dict.hero.ctaPrimary}</Link>
  // <FlowMock lang={lang} />
}
```
`flow-mock.tsx` construye sus 3 pasos (IN/HOOK/OUT) desde `dict.flowMock`; los labels `IN/HOOK/OUT`
quedan fijos. `how-it-works.tsx` usa `dict.howItWorks.stepLabel` para "Paso"/"Step". `comparison-table.tsx`
pasa `dict.comparison.yes`/`.no` a los `aria-label` de los íconos ✓/✗.

Las **vistas** (`landing-view`, `pricing-view`, `blog-list-view`, `blog-post-view`, `login-view`,
`register-view`) son wrappers que arman `SiteBackground + SiteHeader lang + <main> + SiteFooter lang`,
incluyen `<HtmlLang lang={lang} />`, y pasan `lang` a cada sección. Cada ruta `app/…/page.tsx` (ES) y
`app/en/…/page.tsx` (EN) solo renderiza `<XView lang="es|en" />` y exporta su metadata.

---

## SECCIÓN 8 — Diccionario ES completo (`content/i18n/es.ts`)

> Copy español final, con todas las correcciones de la Parte 1 ya aplicadas.

```ts
import type { Dict } from "./dictionary"

export const es: Dict = {
  nav: { pricing: "Precios", blog: "Blog", docs: "Docs", login: "Iniciar sesión", getStarted: "Empezá", menu: "Menú", openMenu: "Abrir menú" },

  hero: {
    eyebrow: "recibe y responde mensajes de Facebook por API",
    title: "La API relay para mensajes de Facebook.",
    titleAccent: "Developer-first.",
    subtitle: "Conecta tu página, apunta tu webhook y responde con un POST. Sin builders visuales ni features que no usás.",
    ctaPrimary: "Empezá",
    ctaSecondary: "Ver cómo funciona",
  },

  flowMock: {
    live: "message-flow · en vivo",
    in: { meta: "Facebook · 14:02", text: "Hola, ¿tienen turno para hoy?" },
    hook: { meta: "tu servidor", text: "Tu automatización recibe el mensaje y genera la respuesta" },
    out: { meta: "POST · 14:02", text: "¡Sí! Te espero hoy a las 15:00 👍" },
  },

  pain: {
    kicker: "el problema",
    title: "El dolor de siempre",
    subtitle: "Si ya intentaste procesar mensajes de Facebook, sabés de qué hablamos.",
    questions: [
      "¿Cómo conecto mi n8n a Facebook?",
      "Conectar cualquier automatización a Facebook es un dolor de cabeza",
      "Solamente necesito la API, ¿alguien conoce algo más barato?",
      "Quiero algo donde pueda manejar los agentes de todos mis clientes",
      "Necesito algo sencillo y rápido para conectarme a la página del cliente",
    ],
    items: [
      { icon: "wallet", title: "Pagás por funciones que ni abrís", body: "Los planes caros vienen con builders, templates y analytics de engagement. Vos solo querés recibir y responder mensajes." },
      { icon: "unplug", title: "Conectar con Facebook es un laberinto", body: "Reviewers, tokens que expiran, permisos y webhooks. Capaz ya lo intentaste directo y quedaste en el camino." },
      { icon: "users", title: "Malabares con varios clientes", body: "Sos agencia y cada cliente es otra página, otra automatización y otra cuenta que mantener en orden." },
      { icon: "zap", title: "Necesitás algo simple y rápido", body: "Conectarte a la página de un cliente debería tomar minutos, no una tarde entera de configuración." },
    ],
  },

  howItWorks: {
    kicker: "flujo",
    title: "De cero a recibiendo mensajes en minutos",
    subtitle: "",
    stepLabel: "Paso",
    steps: [
      { title: "Conecta tu página", body: "Vinculá tu página de Facebook con un par de clics." },
      { title: "Configurá tu webhook", body: "Pegá la URL de tu webhook y Resender empieza a reenviarte los mensajes entrantes." },
      { title: "Recibe los mensajes", body: "Cada mensaje llega a tu endpoint como JSON, listo para tu automatización." },
      { title: "Responde por API", body: "Hacé un POST de vuelta a Resender y entregamos la respuesta al usuario final." },
    ],
  },

  quickstart: { kicker: "quickstart", title: "Una request y ya estás respondiendo", subtitle: "Un POST desde tu backend, desde n8n, desde donde sea.", filename: "reply.request" },

  features: {
    kicker: "features",
    title: "Todo lo que necesitás",
    subtitle: "La API que querías, sin el peso de una plataforma no-code.",
    items: [
      { icon: "code", title: "Developer-first", body: "API limpia, webhooks claros y documentación real. Sin UI innecesaria." },
      { icon: "wallet", title: "Precio accesible", body: "Desde $15/mes contra los $39+ de ManyChat. Pagás por lo que usás.", hidden: true },
      { icon: "zap", title: "Setup en minutos", body: "Conectás, configurás el webhook y estás recibiendo mensajes. Sin fricción." },
      { icon: "plug", title: "Compatible con tu stack", body: "Funciona con n8n, Make, Zapier o tu código custom. Vos elegís." },
      { icon: "messages", title: "Facebook, Instagram y WhatsApp", body: "Un solo relay para los tres canales de mensajería de Facebook.", hidden: true },
    ],
  },

  pricingPreview: { kicker: "pricing", title: "Planes simples y transparentes", subtitle: "Elegí el que se ajuste a tu volumen. Cambiá cuando quieras.", cta: "Ver planes completos" },

  about: {
    title: "Por qué construimos Resender",
    body: [
      "Usábamos ManyChat para nuestros propios proyectos, pero solo necesitábamos la API: recibir mensajes y responderlos desde nuestras automatizaciones. Estábamos pagando por un montón de features que nunca abríamos.",
      "Así que construimos lo que nos hubiera gustado tener: un relay directo y pensado para developers. Resender es esa herramienta, ahora disponible para vos.",
    ],
  },

  faq: {
    kicker: "faq",
    title: "Preguntas frecuentes",
    items: [
      { q: "¿Con qué canales funciona Resender?", a: "Hoy Resender funciona con páginas de Facebook (Messenger). Conectás tu página y empezás a recibir mensajes en tu webhook." },
      { q: "¿Necesito aprobación de Facebook para usar Resender?", a: "Resender maneja la integración con las APIs de Facebook por vos. Según tu caso de uso puede requerirse revisión de Facebook, pero te guiamos en el proceso." },
      { q: "¿Cómo funciona el webhook?", a: "Configurás una URL HTTPS por página. Cuando llega un mensaje, Resender lo persiste y lo reenvía a tu endpoint como JSON. Respondés con un POST a nuestra API de salida." },
      { q: "¿Puedo usar Resender con n8n, Make o Zapier?", a: "Sí. Resender es solo API, así que se integra con cualquier herramienta no-code/low-code o con tu propio código." },
      { q: "¿Qué pasa si me paso de los mensajes de mi plan?", a: "Te avisamos cuando te acercás al límite y podés subir de plan en cualquier momento sin perder configuración." },
      { q: "¿Puedo cambiar de plan en cualquier momento?", a: "Sí, podés subir o bajar de plan cuando quieras. Los cambios se aplican en tu próximo ciclo de facturación." },
      { q: "¿Qué métodos de pago aceptan?", a: "Aceptamos las principales tarjetas de crédito y débito a través de Stripe." },
    ],
  },

  finalCta: { title: "¿Listo para empezar?", subtitle: "Conecta tu primera página y recibe mensajes en minutos. Sin tarjeta para arrancar.", cta: "Empezá" },

  pricing: {
    kicker: "pricing",
    title: "Precios",
    subtitle: "Un plan para cada etapa. Sin contratos, sin sorpresas. Cancelás cuando quieras.",
    plans: [
      { name: "Starter", price: "$15", period: "/mes", description: "Para arrancar tu primer proyecto.", featured: false, badge: null, cta: "Empezar con Starter", features: ["50.000 mensajes por mes", "2 páginas de Facebook", "Soporte por email + Discord"] },
      { name: "Pro", price: "$25", period: "/mes", description: "Para devs y agencias en crecimiento.", featured: true, badge: "Recomendado", cta: "Empezar con Pro", features: ["100.000 mensajes por mes", "5 páginas de Facebook", "Soporte por email + Discord"] },
    ],
  },

  comparison: {
    kicker: "vs manychat",
    title: "Resender vs ManyChat",
    subtitle: "Si solo necesitás la API de Facebook, estás pagando de más. Mirá la diferencia.",
    yes: "Sí", no: "No",
    headers: { feature: "", resender: "Resender", manychat: "ManyChat" },
    rows: [
      { feature: "Precio de entrada", resender: "$15/mes", manychat: "$39+/mes" },
      { feature: "API limpia y webhooks", resender: true, manychat: true },
      { feature: "Sin builders visuales de más", resender: true, manychat: false },
      { feature: "Enfoque developer-first", resender: true, manychat: false },
      { feature: "Setup en minutos", resender: true, manychat: false },
      { feature: "Integra con n8n / Make / Zapier", resender: true, manychat: true },
      { feature: "Templates visuales y analytics de engagement", resender: "No los necesitás", manychat: true },
    ],
  },

  pricingFaq: {
    kicker: "faq",
    title: "Preguntas sobre precios",
    items: [
      { q: "¿Qué pasa si me paso de los mensajes?", a: "Te avisamos cuando te acercás al límite. Podés subir de plan sin interrupciones." },
      { q: "¿Puedo cambiar de plan?", a: "Sí, subís o bajás de plan cuando quieras. Los cambios se prorratean en tu próximo ciclo." },
      { q: "¿Hay contrato o compromiso?", a: "No. Es mes a mes y cancelás cuando quieras, sin penalidades." },
      { q: "¿Qué métodos de pago aceptan?", a: "Tarjetas de crédito y débito a través de Stripe." },
      { q: "¿Hay trial gratuito?", a: "Podés crear tu cuenta y explorar el producto antes de elegir un plan pago." },
    ],
  },

  pricingCta: { title: "Empezá a construir hoy", subtitle: "Creá tu cuenta y conecta tu primera página en minutos.", cta: "Empezá" },

  blog: {
    metaTitle: "Blog — Resender",
    metaDescription: "Tutoriales y novedades sobre cómo integrar mensajes de Facebook con Resender.",
    title: "Blog",
    subtitle: "Tutoriales y novedades del producto.",
    empty: "Todavía no hay posts publicados.",
    back: "← Volver al blog",
    reading: { title: "¿Listo para empezar?", subtitle: "Conecta tu primera página y recibe mensajes en minutos.", cta: "Empezá" },
    categories: { tutorial: "Tutorial", actualizacion: "Novedades" },
    rssTitle: "Resender Blog",
    rssDescription: "Tutoriales y novedades de Resender.",
  },

  auth: {
    login: { title: "Iniciar sesión", subtitle: "Ingresá para administrar tus conexiones y el registro de mensajes." },
    register: { title: "Crear cuenta", subtitle: "Creá una cuenta con email y contraseña. En el MVP no hay verificación por email." },
    passwordChanged: "Contraseña actualizada. Ingresá con tu nueva contraseña.",
    form: { email: "Email", password: "Contraseña", emailPlaceholder: "vos@empresa.com", passwordPlaceholder: "Al menos 8 caracteres", processing: "Procesando...", signIn: "Ingresar", createAccount: "Crear cuenta", noAccount: "¿No tenés cuenta?", haveAccount: "¿Ya tenés cuenta?", signUp: "Registrate", signInAction: "Ingresá" },
    errors: { invalidCredentials: "Email o contraseña incorrectos.", duplicateEmail: "Ese email ya está registrado. Iniciá sesión.", invalidInput: "Revisá el email y la contraseña e intentá de nuevo.", createdNoSignin: "Creamos la cuenta, pero no pudimos iniciar sesión." },
  },

  footer: {
    tagline: "La API relay para mensajes de Facebook. Simple y developer-first.",
    columns: { product: "Producto", legal: "Legal", contact: "Contacto" },
    links: { pricing: "Precios", blog: "Blog", docs: "Docs", privacy: "Privacidad", terms: "Términos", dataDeletion: "Eliminación de datos" },
  },

  meta: {
    home: {
      title: "Resender — La API relay para mensajes de Facebook",
      description: "La alternativa developer-first a ManyChat. Recibe mensajes de Facebook en tu webhook y responde por API. Simple y sin features que no usás.",
      ogTitle: "Resender — La API relay para mensajes de Facebook",
      ogDescription: "Recibe mensajes de Facebook en tu webhook y responde por API. Simple y developer-first.",
    },
    pricing: {
      title: "Precios — Resender",
      description: "Planes desde $15/mes. Compará Resender con ManyChat y elegí el plan que se ajuste a tu volumen de mensajes. Sin contratos.",
      ogTitle: "Precios — Resender",
      ogDescription: "Planes simples desde $15/mes. La alternativa developer-first a ManyChat.",
    },
  },
}
```

---

## SECCIÓN 9 — Diccionario EN completo (`content/i18n/en.ts`)

> **Este es el copy en inglés que se usó.** Es el entregable creativo principal a preservar.

```ts
import type { Dict } from "./dictionary"

export const en: Dict = {
  nav: { pricing: "Pricing", blog: "Blog", docs: "Docs", login: "Log in", getStarted: "Get started", menu: "Menu", openMenu: "Open menu" },

  hero: {
    eyebrow: "receive and reply to Facebook messages via API",
    title: "The relay API for Facebook messages.",
    titleAccent: "Developer-first.",
    subtitle: "Connect your Page, point your webhook and reply with a POST. No visual builders, no features you'll never use.",
    ctaPrimary: "Get started",
    ctaSecondary: "See how it works",
  },

  flowMock: {
    live: "message-flow · live",
    in: { meta: "Facebook · 2:02 PM", text: "Hi, do you have a slot for today?" },
    hook: { meta: "your server", text: "Your automation receives the message and generates the reply" },
    out: { meta: "POST · 2:02 PM", text: "Yes! See you today at 3:00 PM 👍" },
  },

  pain: {
    kicker: "the problem",
    title: "The same old pain",
    subtitle: "If you've ever tried to process Facebook messages, you know exactly what we mean.",
    questions: [
      "How do I connect my n8n to Facebook?",
      "Connecting any automation to Facebook is a headache",
      "I just need the API — does anyone know something cheaper?",
      "I want one place to manage the agents for all my clients",
      "I need something simple and fast to connect to a client's Page",
    ],
    items: [
      { icon: "wallet", title: "You pay for features you never open", body: "Expensive plans come with builders, templates and engagement analytics. You just want to receive and reply to messages." },
      { icon: "unplug", title: "Connecting to Facebook is a maze", body: "Reviewers, expiring tokens, permissions and webhooks. Maybe you already tried the direct route and gave up halfway." },
      { icon: "users", title: "Juggling multiple clients", body: "You're an agency, and every client is another Page, another automation and another account to keep in order." },
      { icon: "zap", title: "You need something simple and fast", body: "Connecting to a client's Page should take minutes, not a whole afternoon of setup." },
    ],
  },

  howItWorks: {
    kicker: "flow",
    title: "From zero to receiving messages in minutes",
    subtitle: "",
    stepLabel: "Step",
    steps: [
      { title: "Connect your Page", body: "Link your Facebook Page in a couple of clicks." },
      { title: "Set up your webhook", body: "Paste your webhook URL and Resender starts forwarding incoming messages to you." },
      { title: "Receive the messages", body: "Every message arrives at your endpoint as JSON, ready for your automation." },
      { title: "Reply via API", body: "Make a POST back to Resender and we deliver the reply to the end user." },
    ],
  },

  quickstart: { kicker: "quickstart", title: "One request and you're already replying", subtitle: "A POST from your backend, from n8n, from wherever.", filename: "reply.request" },

  features: {
    kicker: "features",
    title: "Everything you need",
    subtitle: "The API you wanted, without the weight of a no-code platform.",
    items: [
      { icon: "code", title: "Developer-first", body: "Clean API, clear webhooks and real documentation. No unnecessary UI." },
      { icon: "wallet", title: "Affordable pricing", body: "From $15/mo versus ManyChat's $39+. You pay for what you use.", hidden: true },
      { icon: "zap", title: "Setup in minutes", body: "Connect, configure the webhook and you're receiving messages. No friction." },
      { icon: "plug", title: "Works with your stack", body: "Works with n8n, Make, Zapier or your own custom code. Your call." },
      { icon: "messages", title: "Facebook, Instagram and WhatsApp", body: "One relay for all three Facebook messaging channels.", hidden: true },
    ],
  },

  pricingPreview: { kicker: "pricing", title: "Simple, transparent plans", subtitle: "Pick the one that fits your volume. Change whenever you want.", cta: "See full plans" },

  about: {
    title: "Why we built Resender",
    body: [
      "We used ManyChat for our own projects, but all we needed was the API: receiving messages and replying to them from our automations. We were paying for a pile of features we never opened.",
      "So we built what we wished we'd had: a direct relay made for developers. Resender is that tool, now available to you.",
    ],
  },

  faq: {
    kicker: "faq",
    title: "Frequently asked questions",
    items: [
      { q: "Which channels does Resender work with?", a: "Today Resender works with Facebook Pages (Messenger). You connect your Page and start receiving messages at your webhook." },
      { q: "Do I need Facebook approval to use Resender?", a: "Resender handles the integration with Facebook's APIs for you. Depending on your use case, Facebook review may be required, but we guide you through the process." },
      { q: "How does the webhook work?", a: "You set an HTTPS URL per Page. When a message comes in, Resender persists it and forwards it to your endpoint as JSON. You reply with a POST to our outbound API." },
      { q: "Can I use Resender with n8n, Make or Zapier?", a: "Yes. Resender is API-only, so it plugs into any no-code/low-code tool or your own code." },
      { q: "What happens if I go over my plan's messages?", a: "We let you know when you're getting close to the limit, and you can upgrade anytime without losing your setup." },
      { q: "Can I change plans at any time?", a: "Yes, you can upgrade or downgrade whenever you want. Changes take effect on your next billing cycle." },
      { q: "What payment methods do you accept?", a: "We accept major credit and debit cards through Stripe." },
    ],
  },

  finalCta: { title: "Ready to get started?", subtitle: "Connect your first Page and receive messages in minutes. No card to get going.", cta: "Get started" },

  pricing: {
    kicker: "pricing",
    title: "Pricing",
    subtitle: "A plan for every stage. No contracts, no surprises. Cancel whenever you want.",
    plans: [
      { name: "Starter", price: "$15", period: "/mo", description: "To get your first project off the ground.", featured: false, badge: null, cta: "Get started with Starter", features: ["50,000 messages per month", "2 Facebook Pages", "Email + Discord support"] },
      { name: "Pro", price: "$25", period: "/mo", description: "For growing devs and agencies.", featured: true, badge: "Recommended", cta: "Get started with Pro", features: ["100,000 messages per month", "5 Facebook Pages", "Email + Discord support"] },
    ],
  },

  comparison: {
    kicker: "vs manychat",
    title: "Resender vs ManyChat",
    subtitle: "If all you need is the Facebook API, you're overpaying. See the difference.",
    yes: "Yes", no: "No",
    headers: { feature: "", resender: "Resender", manychat: "ManyChat" },
    rows: [
      { feature: "Entry price", resender: "$15/mo", manychat: "$39+/mo" },
      { feature: "Clean API and webhooks", resender: true, manychat: true },
      { feature: "No extra visual builders", resender: true, manychat: false },
      { feature: "Developer-first focus", resender: true, manychat: false },
      { feature: "Setup in minutes", resender: true, manychat: false },
      { feature: "Integrates with n8n / Make / Zapier", resender: true, manychat: true },
      { feature: "Visual templates and engagement analytics", resender: "You don't need them", manychat: true },
    ],
  },

  pricingFaq: {
    kicker: "faq",
    title: "Pricing questions",
    items: [
      { q: "What happens if I go over my messages?", a: "We let you know when you're getting close to the limit. You can upgrade with no interruptions." },
      { q: "Can I change plans?", a: "Yes, upgrade or downgrade whenever you want. Changes are prorated on your next cycle." },
      { q: "Is there a contract or commitment?", a: "No. It's month to month and you cancel whenever you want, no penalties." },
      { q: "What payment methods do you accept?", a: "Credit and debit cards through Stripe." },
      { q: "Is there a free trial?", a: "You can create your account and explore the product before choosing a paid plan." },
    ],
  },

  pricingCta: { title: "Start building today", subtitle: "Create your account and connect your first Page in minutes.", cta: "Get started" },

  blog: {
    metaTitle: "Blog — Resender",
    metaDescription: "Tutorials and news on integrating Facebook messages with Resender.",
    title: "Blog",
    subtitle: "Product tutorials and news.",
    empty: "No posts published yet.",
    back: "← Back to blog",
    reading: { title: "Ready to get started?", subtitle: "Connect your first Page and receive messages in minutes.", cta: "Get started" },
    categories: { tutorial: "Tutorial", actualizacion: "News" },
    rssTitle: "Resender Blog",
    rssDescription: "Tutorials and news from Resender.",
  },

  auth: {
    login: { title: "Log in", subtitle: "Sign in to manage your connections and message log." },
    register: { title: "Create account", subtitle: "Create an account with email and password. There's no email verification in the MVP." },
    passwordChanged: "Password updated. Sign in with your new password.",
    form: { email: "Email", password: "Password", emailPlaceholder: "you@company.com", passwordPlaceholder: "At least 8 characters", processing: "Processing...", signIn: "Sign in", createAccount: "Create account", noAccount: "Don't have an account?", haveAccount: "Already have an account?", signUp: "Sign up", signInAction: "Sign in" },
    errors: { invalidCredentials: "Incorrect email or password.", duplicateEmail: "That email is already registered. Sign in.", invalidInput: "Check your email and password and try again.", createdNoSignin: "The account was created, but we couldn't sign you in." },
  },

  footer: {
    tagline: "The relay API for Facebook messages. Simple and developer-first.",
    columns: { product: "Product", legal: "Legal", contact: "Contact" },
    links: { pricing: "Pricing", blog: "Blog", docs: "Docs", privacy: "Privacy", terms: "Terms", dataDeletion: "Data deletion" },
  },

  meta: {
    home: {
      title: "Resender — The relay API for Facebook messages",
      description: "The developer-first alternative to ManyChat. Receive Facebook messages at your webhook and reply via API. Simple, with no features you'll never use.",
      ogTitle: "Resender — The relay API for Facebook messages",
      ogDescription: "Receive Facebook messages at your webhook and reply via API. Simple and developer-first.",
    },
    pricing: {
      title: "Pricing — Resender",
      description: "Plans from $15/mo. Compare Resender with ManyChat and pick the plan that fits your message volume. No contracts.",
      ogTitle: "Pricing — Resender",
      ogDescription: "Simple plans from $15/mo. The developer-first alternative to ManyChat.",
    },
  },
}
```

---

## SECCIÓN 10 — Cuerpo de los posts de blog en inglés

> Volcar sobre la estructura de blog que exista en `main` nuevo (mismo slug que su versión ES).

### 10.1 `we're launching` (slug equivalente al de "Lanzamos Resender")

Frontmatter: `title: "We're launching Resender"`, `abstract: "Why we built a developer-first relay
API for Facebook messages."`, `category: "actualizacion"`, `author: "The Resender Team"`, `lang: "en"`,
misma `publishedOn` que el ES (2026-07-15). Cuerpo:

```md
Today we're launching **Resender**: the simplest way to receive and reply to Facebook messages via API.

## The problem

We used ManyChat for our own projects, but all we needed was the API. We were paying $39+ a month for drag & drop builders, visual templates and engagement analytics we never opened.

And if you've ever tried to integrate directly with Facebook, you already know the story: reviewers, expiring tokens, permissions and webhooks to maintain.

## The solution

Resender is a direct relay between Facebook's APIs and your endpoint:

1. Connect your Page.
2. Set up your webhook.
3. Receive the messages and reply via API.

No builders, no noise. Just the API you need, from **$15/mo**.

## What's next

We're working on more integration templates (Make, Zapier), expanded documentation and Discord support. If you want to follow the development closely, join our community.

Ready to get started? [Create your account](/en/register) and connect your first Page in minutes.
```

### 10.2 `connect Resender with n8n` (slug equivalente al de "conectar-resender-con-n8n")

Frontmatter: `title: "How to connect Resender with n8n"`, `abstract: "A step-by-step guide to setting
up your first Facebook message flow with n8n and Resender."`, `category: "tutorial"`,
`author: "The Resender Team"`, `lang: "en"`, misma `publishedOn` que el ES (2026-07-21). Cuerpo:

```md
In this tutorial you'll connect a Facebook Page to **Resender** and build a flow in **n8n** that receives incoming messages and replies automatically. All in under 15 minutes.

## What you'll need

- A Resender account with a connected Facebook Page.
- An n8n instance (cloud or self-hosted).
- A Resender API key (create one from **Settings**).

## Step 1 — Receive messages in n8n

Create a **Webhook** node in n8n and copy its public URL. In Resender, go to **Connections**, pick your Page and paste that URL into the **webhook URL** field.

From now on, every incoming message arrives at n8n as JSON:

​```json
{
  "tenant": { "id": "ten_123" },
  "page": { "id": "pg_456", "metaPageId": "102938475610111" },
  "conversation": { "id": "conv_789", "contactId": "6543210987654321" },
  "message": { "direction": "inbound", "status": "received", "text": "Hi!" }
}
​```

## Step 2 — Reply through the API

Add an **HTTP Request** node pointing to Resender's outbound endpoint:

​```bash
curl -X POST https://resender.dev/api/meta/send \
  -H "Authorization: Bearer pk_live_your_secret" \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "102938475610111",
    "recipientId": "6543210987654321",
    "reply": "Thanks for reaching out! How can we help?"
  }'
​```

> Heads up: `pageId` is the `page.metaPageId` from the incoming payload (not the internal `page.id`), and `recipientId` is the `conversation.contactId`.

## Done

With those two nodes you've got a working bot on Messenger, without paying for features you don't use. In the next tutorial we'll look at how to branch replies based on the message content.
```

> Nota: en 10.2 los code fences reales usan ``` (acá están escapados con un carácter invisible para no
> romper este documento).

---

## SECCIÓN 11 — Docs (menciones de marca)

En `app/docs/page.mdx`, solo prosa de marca:
- "…matches this value against the Page's **Facebook** ID…"
- "**`meta`** is **Facebook's** raw passthrough response — … treat it as **Facebook's** contract."

Mantener sin cambios: la key `meta`, `metaPageId`, `metaMessageId`, rutas `api/meta/send`,
placeholders y referencias a archivos fuente.
