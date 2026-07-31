# Resender.dev — Decisiones de diseño y bitácora creativa

> Documento vivo con todas las decisiones de diseño, creativas y de implementación
> del sitio de marketing (y su alineación con el app). Complementa
> `resender-website-spec.md` (la spec original / fuente de verdad) registrando
> **qué se construyó, cómo y por qué**, incluyendo dónde nos desviamos de la spec.
>
> Contexto: el sitio se construyó dentro del mismo app Next.js (`apps/web`), sin
> tocar backend, auth ni la lógica de dominio del dashboard.

---

## 1. Decisiones macro (y desvíos de la spec)

| Decisión | Qué se eligió | Por qué |
|----------|---------------|---------|
| **Idioma** | **Español primero** (la spec pedía inglés por defecto) | Se priorizó arrancar en español. Copy centralizado en `content/i18n/es.ts` para clonar a `en.ts` y sumar ruteo `/en · /es` después sin reescribir markup. **No** hay ruteo `[lang]` ni middleware todavía. `<html lang="es">`. |
| **Paleta** | Aplicada **globalmente** (afecta también al dashboard) | Unificar la marca en toda la superficie. Se reemplazaron los tokens neutrales del `globals.css` compartido por la paleta crema/violeta. |
| **Switch de tema** | **Removido del sitio.** El modo definitivo es el **claro** | El toggle era temporal, para evaluación interna entre founders. Elegido el modo, se removió de la navbar. El sitio queda en claro por CSS: cada vista de marketing se envuelve en `.light`, y `globals.css` declara los tokens claros con `:root, .light` — así el sitio ignora el `.dark` que `next-themes` pueda poner en `<html>` (preferencia del SO, `localStorage` viejo, hotkey "d") sin depender de JS ni sufrir FOUC. **La consola conserva su switch y su modo oscuro.** |
| **Registro de español** | **Tuteo neutro en todo el sitio** ("Conecta", "Empieza", "Necesitas") | El sitio nació en voseo rioplatense y el producto en tuteo neutro (ADR 0005), así que convivían dos registros en el mismo dominio. Se unificó la copy pública al registro del producto. |
| **Arquitectura** | El marketing vive en el **mismo** `apps/web` que el dashboard | Evita un app separado; comparten UI package, tokens y fuentes. |
| **URLs legales** | `/privacy` y `/data-deletion` **no se mueven** | Están hardcodeadas en el panel de Meta (ver `CONTEXT.md`). No entran bajo `[lang]`. |
| **Vibra visual** | "Showpieces + acentos" IDE/código | Personalidad de developer sin recargar (referencia: Resend, Linear, Vercel). |

---

## 2. Sistema de diseño

### 2.1 Paleta (`packages/ui/src/styles/globals.css`)

Tokens shadcn en hex, definidos para `:root` (claro) y `.dark` (oscuro). Acento violeta `#7773a5` en **ambos** modos.

| Token | Claro | Oscuro |
|-------|-------|--------|
| `--background` | `#f3ece0` (crema) | `#242029` (morado oscuro) |
| `--foreground` | `#242029` | `#f3ece0` |
| `--primary` | `#7773a5` (violeta) | `#7773a5` |
| `--card` | `#ffffff` | `#2e2a35` |
| `--muted` | `#ebe4d6` | `#35303d` |
| `--border` | `#d4cfc7` | `#3d3845` |

- `--chart-*` derivados en familia violeta; `--sidebar-*` coherentes con card/bg de cada modo; `--destructive` se mantuvo rojo.
- **Secciones de contraste** (CTA final, footer): usan `bg-foreground` / `text-background`, así en claro se ven con el **morado oscuro** y en oscuro con el **crema** — el tono se invierte respecto del resto.

### 2.2 Tipografías

| Uso | Fuente | Cómo |
|-----|--------|------|
| Headings + logo "Resender" | **HK Grotesk Pro** (Bold/SemiBold/Medium) | `next/font/local` (woff2 en `app/fonts/`), variable `--font-hk` → token `--font-heading`. Regla base `h1..h4 { font-family: var(--font-heading) }`. |
| Código, snippets, `.dev`, kickers `//` | **Space Mono** | `next/font/google`, variable `--font-mono`. |
| Body | **Inter** | `next/font/google`, variable `--font-sans`. |

### 2.3 Componentes shadcn agregados (`packages/ui`)

`card`, `badge`, `accordion`, `table`, `tabs`, `switch`, `navigation-menu`, `separator`, `sheet`, `dropdown-menu`, más un `bg-pattern` custom. Estilo `radix-nova`, paquete unificado `radix-ui`.

### 2.4 Logo (`components/site-logo.tsx`)

- **"Resender"** en HK Grotesk Bold + **".dev"** en Space Mono Bold violeta (el punto también violeta).
- Ajuste fino: `.dev` con `-ml-0.5` + `tracking-tight` para acercarlo a "Resender" sin pegarlo (el cell de la mono agrega aire alrededor del punto).
- Prop `href` (default `/`) para reusarlo dentro del app apuntando a `/connections`.

---

## 3. Chrome compartido

- **`SiteHeader`**: navbar sticky con blur, altura `h-16`. Logo + links (Precios, Blog, Docs) + toggle de idioma + botones Login (outline) y "Empieza" (primary). Menú mobile con `Sheet`. Sin toggle de tema: el sitio es solo modo claro.
- **`SiteFooter`**: sección de contraste (morado oscuro / crema invertido), columnas Producto / Legal / Contacto, logo y copyright.
- **`SiteBackground`**: patrón `BGPattern` variante **`grid`** (celdas ~40px), fijo al viewport, con `mask` fade en bordes y `fill` theme-aware (`color-mix(in oklab, var(--foreground) 10%, transparent)`). Solo en páginas de marketing, **no** en el dashboard. (Se probó `dots` primero; se cambió a `grid`.)
- **`ThemeToggle`**: `Switch` sol/luna sobre next-themes (persistencia en localStorage). Convive con el hotkey "d". **Ya no se usa en el sitio**; queda solo en el sidebar de la consola (`features/shell/ui/app-sidebar.tsx`).

---

## 4. Estructura de la landing (`/`)

Orden final de secciones:

1. **Hero**
2. **El dolor de siempre** (pain points)
3. **Cómo funciona** (timeline)
4. **Quickstart** (panel de código)
5. **Pricing preview**
6. **FAQ**
7. **CTA final** (contraste)
8. **Footer** (contraste)

> Secciones **eliminadas** en el camino: "Por qué construimos Resender" (About) y "Todo lo que necesitás" (Features). Los íconos de las features removidas (billetera, mensajes) se preservaron para reuso futuro.

### 4.1 Hero (`features/marketing/ui/hero.tsx`)

- Kicker mono `// recibí y respondé mensajes de Facebook por API` (arranca en **minúscula**, como todas las labels `//` del sitio).
- Título: "La API relay para mensajes de Meta." + acento **"Developer-first."** en su **propia línea** (`<br/>`) para que no salte al tipearse.
- **Animación**: "Developer-first" se **tipea una sola vez** al cargar (`Typewriter`), con un **caret que parpadea** al final. Respeta `prefers-reduced-motion`.
- CTAs → `/register` (primario) y scroll a "Cómo funciona" (secundario).
- Se sacaron de la propuesta las palabras **"simple"** (como claim en el acento) → la idea de simple quedó en el subtítulo; y **"económica"/"accesible"** en todo el sitio.

### 4.2 FlowMock — el visual del hero (`flow-mock.tsx`)

Evolucionó bastante; estado final = **diseño "1b" (timeline)** animado:

- Timeline con header `message-flow · en vivo` y 3 pasos conectados por una línea: **IN** (llega el mensaje) → **HOOK** (tu automatización) → **OUT** (tu respuesta), cada uno con su punto (violeta lleno / hueco / oscuro).
- Adaptado con tokens → funciona en claro y oscuro.
- **Animación en loop** (~5.2s): aparece IN → se **pinta** la línea IN→HOOK (`scaleY`) → aparece HOOK → se pinta la línea HOOK→OUT → aparece OUT. `prefers-reduced-motion` lo deja estático.

Historia del componente (por si sirve de contexto):
- v1: card con "mensaje entrante" + texto genérico → se descartó por poco explicativa.
- v2: diagrama vertical con flechas y etiquetas "Resender reenvía…" → se simplificó (demasiada info).
- v3: burbujas tipo chat con piquito + spinner que giraba una vuelta y se volvía tilde → buena, pero se pidió un layout más parejo.
- v4 (final): timeline 1b, más limpio y "de producto".

### 4.3 El dolor de siempre (`pain-point.tsx`)

- Kicker `// el problema`. Sección en tono base (se **quitó** el fondo `muted` para que no quede línea divisoria; blende con el background).
- **Marquee de preguntas** (`question-marquee.tsx`): 2 renglones que se mueven en direcciones opuestas (CSS puro, bubbles redondeadas). Quejas/preguntas reales de usuarios (n8n, "algo más barato", agencias con muchos clientes, "algo sencillo y rápido").
- **4 pain cards horizontales** (grid 2×2):
  1. Pagas por funciones que ni abres
  2. Conectar con Meta es un laberinto
  3. Malabares con varios clientes (agencias)
  4. Necesitas algo simple y rápido

### 4.4 Cómo funciona (`how-it-works.tsx`)

Timeline de 3–4 pasos con íconos (lucide), nodos conectados por una línea, `Paso 0N` en mono, y entrada escalonada (`Reveal`).

### 4.5 Quickstart — showpiece de código (`quickstart.tsx`, `code-tabs.tsx`)

- Panel tipo editor con **chrome de ventana** (semáforo ●●● + `reply.request`).
- Tabs **curl / Node.js / Python** (shadcn `Tabs`).
- **Syntax highlighting real** con **shiki** (server, build time), temas duales claro/oscuro.
  - Fix de legibilidad en oscuro: `defaultColor: false` para que los tokens sean CSS vars y alternen con `.dark` (antes el color claro quedaba fijo e ilegible).
- **Números de línea** vía counters CSS sobre `.line` (clase `.code-panel`).
- **Botón de copiar**: ícono de portapapeles solo (Copy → Check), **arriba a la derecha del código** (no en la fila de tabs).
- Snippet = el POST publico real a
  `https://api.resender.dev/v1/messages`, con `Idempotency-Key` obligatorio,
  `pageId` UUID interno, `recipientId`, `type` y `text`. Todos los valores son
  placeholders (nunca secretos).

---

## 5. Pricing (landing preview + `/pricing`)

- **2 planes** (se eliminó Business):

| | Starter | Pro ⭐ (Recomendado) |
|---|---------|----------------------|
| Precio | $15/mes | $25/mes |
| Mensajes | 50.000 / mes | 100.000 / mes |
| Páginas de Facebook | 2 | 5 |
| Soporte | Email + Discord | Email + Discord |

- `PlanCards` en 2 columnas centradas; **las features se muestran tanto en la landing como en la tab de pricing**.
- Pro destacado con `ring-primary` + badge "Recomendado".
- Además: tabla comparativa **vs ManyChat**, FAQ de pricing, CTA final.
- CTAs → `/register` (`TODO: Stripe`).

---

## 6. Blog (MDX)

- Posts como `.mdx` en `content/blog/` con frontmatter (`title`, `abstract`, `category`, `isPublished`, `publishedOn`, `author`, `lang`).
- Loader `lib/blog.ts` (módulo nuevo, no toca la lógica de dominio): `gray-matter` para el frontmatter; render con `next-mdx-remote/rsc` (`compileMDX`) + `remark-gfm` + `rehype-pretty-code` (shiki).
- Rutas: listado `/blog` (grid de cards con badge de categoría) y post `/blog/[slug]` (SSG, wrapper `prose`, CTA al final).
- 2 posts de ejemplo en español.

---

## 7. Legales

`/privacy`, `/terms`, `/data-deletion`: restyle con `SiteHeader` + `SiteFooter`, **sin tocar el texto legal** ni sus URLs (fijas para Meta).

---

## 8. Acentos "IDE / código"

- **Kickers `//`** en las secciones (`// el problema`, `// flujo`, `// quickstart`, `// pricing`, `// vs manychat`, `// faq`), todos en **minúscula** (estilo comentario).
- **Caret parpadeante** en el hero.
- **Chrome de ventana** (semáforo) en paneles de código.
- **Monospace** (Space Mono) para labels técnicas, `.dev`, snippets.

---

## 9. SEO

- `sitemap.xml` (rutas estáticas + posts).
- **RSS** del blog (`/blog/rss.xml`).
- `metadata` (title/description/openGraph) por página; en el blog se genera desde el frontmatter.

---

## 10. Animaciones (keyframes en `globals.css`)

| Keyframe / clase | Uso |
|------------------|-----|
| `caret-blink` | Caret del hero |
| `node-pop` | Aparición de pasos (FlowMock, timeline) |
| `connector-draw` | "Pintado" de las líneas del FlowMock (`scaleY`) |
| `marquee` / `.animate-marquee(-reverse)` | Renglones de preguntas del pain section |
| `.code-panel` counters | Números de línea del código |
| `.shiki` dual | Alternancia de color de tokens claro/oscuro |
| `Typewriter` (JS) | Tipeo único de "Developer-first" |
| `Reveal` (JS, IntersectionObserver) | Entrada escalonada de secciones |

Todo lo animado respeta `prefers-reduced-motion`.

---

## 11. Alineación del app (área logueada)

Se verificó que el dashboard comparta el tono del website. Ya estaba alineado en paleta, fuentes, tokens de card/panel y burbujas de mensajes. Se ajustó:

1. **Logo** de marca `Resender.dev` arriba a la izquierda (mismo `SiteLogo`, apunta a `/connections`).
2. **Header** sticky + blur + `h-16`, con el **toggle de tema**. (Con el rediseño v2 el toggle pasó al sidebar; y desde que el website quedó en modo claro fijo, es el **único** lugar donde vive.)
3. **Títulos de página** de `font-semibold` → `font-bold`.

No se tocó backend, auth ni lógica de dominio.

---

## 12. Fuera de alcance / pendientes (TODO)

- **Stripe Checkout**: pendiente (backend). Hoy los CTA de planes van a `/register`.
- **i18n con ruteo** `/en · /es` + middleware/proxy: pendiente. El copy ya está centralizado para facilitarlo. Cuidar de **no** mover `/privacy` ni `/data-deletion`.
- **Docs externos**: `docs.resender.dev` sigue fuera de este repo y hoy publica
  el contrato legado. Hasta que se actualice y verifique, navbar/footer y el
  redirect temporal `/docs` apuntan al Swagger vigente en
  `https://api.resender.dev/docs`.
- **PostHog / analytics**: pendiente (requiere key en env).
- **Discord**: el link del footer es placeholder hasta tener la invitación real.
- **Precios/límites**: confirmados los de Starter/Pro; sujetos a cambio de producto.

---

## 13. Mapa de archivos clave

- **Tokens/estilos**: `packages/ui/src/styles/globals.css`
- **Fuentes + `lang`**: `apps/web/app/layout.tsx`, `apps/web/app/fonts/`
- **Copy**: `apps/web/content/i18n/es.ts`
- **Chrome**: `apps/web/components/{site-header,site-footer,site-logo,site-background,theme-toggle}.tsx`
- **Secciones de marketing**: `apps/web/features/marketing/ui/*`
- **Blog**: `apps/web/content/blog/*.mdx`, `apps/web/lib/blog.ts`, `apps/web/app/blog/*`
- **Componentes UI**: `packages/ui/src/components/*`
- **App (alineación)**: `apps/web/app/(product)/layout.tsx`, páginas de `(product)` y `(auth)`
