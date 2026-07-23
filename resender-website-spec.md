# Resender.dev — Website Spec

> Documento de especificación para la construcción del sitio web de Resender.dev.
> Fecha: 21 de julio de 2026.
> Este documento es la fuente de verdad. Todo lo que se construya debe seguir lo que está acá.

---

## 1. Qué es Resender

Resender.dev es una API relay SaaS para mensajes de Facebook, Instagram y WhatsApp. Funciona como intermediario entre las APIs de Meta y el endpoint del usuario (webhook). El usuario conecta su página de Facebook, configura un webhook URL, y Resender le reenvía todos los mensajes entrantes. El usuario responde con un POST de vuelta a Resender, que entrega la respuesta al usuario final.

**Propuesta de valor central:** Una alternativa developer-first y económica a ManyChat para quienes solo necesitan la API, sin pagar por un montón de features que no usan (drag & drop builders, templates, analytics que no necesitan). Mientras ManyChat cobra $39+/mes, Resender arranca en $15/mes.

**ICP (Ideal Customer Profile):**
- Desarrolladores que construyen chatbots o automatizaciones con la API de Meta.
- Agencias digitales que usan herramientas no-code/low-code (n8n, Make, Zapier).
- Emprendedores técnicos que necesitan procesar mensajes de IG/FB/WA sin la complejidad de integrar directo con Meta.

---

## 2. Estructura del sitio

### Navegación principal
| Página | Ruta | Descripción |
|--------|------|-------------|
| Home (Landing) | `/` | Página principal de conversión. Incluye secciones de How It Works y About. |
| Pricing | `/pricing` | Página dedicada con la tabla completa de planes y comparación con ManyChat. |
| Blog | `/blog` | Listado de posts. Cada post en `/blog/[slug]`. |
| Docs | `docs.resender.dev` | Subdominio separado. Documentación técnica con búsqueda. |

**Navbar:** Logo (link a home) | Pricing | Blog | Docs (link externo) | **[Login]** (botón outline, va al dashboard existente) | **[Get Started]** (botón primario, va a registro)

### Páginas secundarias (footer)
| Página | Ruta |
|--------|------|
| Privacy Policy | `/privacy` |
| Terms of Service | `/terms` |

### Elementos globales
- **Footer:** Links a Pricing, Blog, Docs, Privacy Policy, Terms of Service, contacto (email), Discord, redes sociales.
- **Soporte:** Link a Discord + email de contacto en el footer. No se necesita sistema de tickets por ahora.

---

## 3. Páginas — Intención, secciones y bloques

### 3.1 HOME / LANDING (`/`)

**Objetivo:** Que un dev o agencia que llega (de TikTok, Reddit, Google, o un link directo) entienda en menos de 30 segundos qué es Resender, por qué le conviene, y se registre.

**CTA principal:** Botón de registro directo ("Get Started" / "Empezá gratis").

#### Secciones en orden:

**HERO**
- Headline principal: propuesta de valor en una frase (ej: "The API relay for Meta messages. Simple. Affordable. Developer-first.").
- Subtítulo que amplíe: qué hace Resender en una oración.
- Botón CTA primario → Registro.
- Botón CTA secundario → Scroll a "How It Works".
- Visual: screenshot del dashboard, o ilustración simplificada del flujo webhook.

**PAIN POINT / PROBLEMA**
- Sección corta que conecte con el dolor del ICP.
- Comunicar: "¿Estás pagando de más por ManyChat solo por la API?" / "¿Intentaste integrar directo con Meta y fue una pesadilla de reviewers, tokens y permisos?"
- Debe sentirse personal, que el dev diga "me están hablando a mí".

**HOW IT WORKS**
- Flujo simplificado en 3-4 pasos visuales con íconos o ilustración:
  1. Conectá tu página de Facebook / Instagram.
  2. Configurá tu webhook URL.
  3. Recibí los mensajes en tu endpoint.
  4. Respondé vía API y Resender entrega el mensaje.
- Tono: simple, claro, técnico pero accesible.

**FEATURES / QUÉ INCLUYE**
- Grid de 4-5 cards con las ventajas clave:
  - Developer-first (API limpia, webhooks, sin UI innecesaria).
  - Precio accesible (desde $15/mes vs $39+ de ManyChat).
  - Setup en minutos (no en días).
  - Compatible con n8n, Make, Zapier, o tu stack custom.
  - Soporte para Facebook, Instagram y WhatsApp.

**PRICING PREVIEW**
- Resumen visual de los 3 tiers (ver sección 3.2 para detalle).
- Link/botón "Ver planes completos" → `/pricing`.

**ABOUT / QUIÉNES SOMOS**
- Sección breve: quiénes son, por qué construyeron esto.
- La historia: usaban ManyChat, les resultaba caro para lo que necesitaban, decidieron construir su propia solución.
- Genera confianza, especialmente siendo un producto nuevo.

**FAQ**
- Preguntas frecuentes generales (no solo de pricing):
  - ¿Qué plataformas soporta Resender?
  - ¿Necesito aprobación de Meta para usar Resender?
  - ¿Cómo funciona el webhook?
  - ¿Puedo usar Resender con n8n/Make/Zapier?
  - ¿Qué pasa si me paso de los mensajes de mi plan?
  - ¿Puedo cambiar de plan en cualquier momento?
  - ¿Qué métodos de pago aceptan?
- Componente: Accordion de shadcn.

**CTA FINAL**
- Repetir el call-to-action antes del footer.
- "Ready to start?" / "¿Listo para empezar?" + botón de registro.

**FOOTER**
- Links: Pricing, Blog, Docs, Privacy Policy, Terms of Service.
- Contacto: email, Discord.
- Redes sociales.
- Copyright.

---

### 3.2 PRICING (`/pricing`)

**Objetivo:** Que alguien que ya entiende qué es Resender pueda comparar los planes, ver el valor vs ManyChat, y elegir.

#### Secciones en orden:

**TABLA DE PLANES**
- 3 tiers en cards lado a lado:

| | Starter | Pro ⭐ (Recomendado) | Business |
|---|---------|---------------------|----------|
| Precio | $15/mes | $25/mes | $60/mes |
| Mensajes | [definir límite] | [definir límite] | [definir límite] |
| Páginas de FB | [definir límite] | [definir límite] | Ilimitadas |
| Soporte | Email | Email + Discord prioritario | Soporte premium |

- El plan Pro debe estar visualmente destacado (borde de color primary, badge de "Recomendado").
- Cada plan con su botón CTA → Registro.
- Nota: completar los límites específicos de mensajes y páginas para cada tier.

**COMPARACIÓN CON MANYCHAT**
- Tabla comparativa lado a lado: ManyChat vs Resender.
- Puntos clave a comunicar:
  - ManyChat cobra $39+/mes; Resender desde $15/mes.
  - ManyChat incluye features que un dev no necesita (drag & drop builder, templates visuales, analytics de engagement). Estás pagando por cosas que no usás.
  - Resender es solo API: limpia, directa, sin ruido.
  - Si solo necesitás la API de Meta para procesar mensajes, Resender es lo que necesitás.

**FAQ DE PRICING**
- ¿Qué pasa si me paso de los mensajes?
- ¿Puedo cambiar de plan?
- ¿Hay contrato o compromiso?
- ¿Qué métodos de pago aceptan?
- ¿Hay trial gratuito?
- Componente: Accordion de shadcn.

**CTA FINAL**
- "Start building today" + botón de registro.

---

### 3.3 BLOG (`/blog`)

**Objetivo:** Atraer tráfico orgánico vía SEO con tutoriales, y comunicar actualizaciones del producto.

#### Página de listado (`/blog`)

- Grid o lista de posts con:
  - Thumbnail (opcional).
  - Título.
  - Fecha de publicación.
  - Badge de categoría.
- Categorías: **Tutorial** | **Actualización**.
- Ordenados por fecha (más recientes primero).

#### Página individual de post (`/blog/[slug]`)

- Post renderizado desde MDX.
- Encabezado: título, autor, fecha, categoría.
- Contenido del post.
- CTA al final: registro o link al siguiente post.

#### Implementación técnica (approach MDX)

Los posts se escriben como archivos `.mdx` en el repositorio, con frontmatter para metadata:

```mdx
---
title: "Cómo conectar Resender con n8n"
abstract: "Guía paso a paso para configurar tu primer flujo de mensajes."
category: "tutorial"
isPublished: true
publishedOn: 2026-07-21
author: "Nombre"
lang: "es"
---

Contenido del post acá...
```

**Flujo de publicación:** Escribir el archivo `.mdx` → push al repo → Next.js lo renderiza automáticamente en build time (SSG). No se necesita CMS.

**Campos del frontmatter:**
- `title` — Título del post.
- `abstract` — Descripción corta (para el listado y SEO meta tags).
- `category` — `"tutorial"` o `"actualizacion"`.
- `isPublished` — `true` o `false` (para borradores).
- `publishedOn` — Fecha de publicación (ISO format).
- `updatedOn` — (opcional) Fecha de última actualización.
- `author` — Nombre del autor.
- `lang` — `"es"` o `"en"`.

---

### 3.4 DOCS (`docs.resender.dev`)

**Objetivo:** Que un desarrollador pueda implementar Resender sin hablar con nadie.

#### Estructura del sidebar:

1. **Getting Started / Quickstart** — Los pasos para estar funcionando en 15 minutos.
2. **Authentication** — API keys, cómo obtenerlas, cómo usarlas.
3. **Core Concepts** — Cómo funciona el relay (flujo webhook entrada/salida).
4. **API Reference** — Endpoints disponibles (enviar mensaje, recibir webhook, etc.).
5. **Integrations** — Plantilla de n8n, ejemplos con Make/Zapier.
6. **Code Examples** — curl, Node.js, Python.
7. **Troubleshooting / FAQ** — Problemas comunes y soluciones.

#### Requisitos:
- Barra de búsqueda global en la parte superior.
- Navegación por sidebar con secciones colapsables.
- Herramienta recomendada: Fumadocs, Nextra, o Mintlify (evaluar cuál se adapta mejor al stack).

---

### 3.5 PRIVACY POLICY (`/privacy`) y TERMS OF SERVICE (`/terms`)

**Objetivo:** Cumplir con los requisitos legales de Meta y generar confianza.

- Páginas estáticas con texto legal.
- Requisito obligatorio de Meta para mantener la aprobación de la app.
- Formato: texto corrido con headings para cada sección.

---

## 4. Reglas de diseño

### Paleta de colores

| Token | Color | Descripción |
|-------|-------|-------------|
| Violeta | `#7773a5` | Color de acento/highlight. Es el color que resalta en AMBOS modos. |
| Crema | `#f3ece0` | Fondo en modo claro, texto en modo oscuro. |
| Dark | `#242029` | Fondo en modo oscuro, texto en modo claro. |
| White | `#ffffff` | Uso auxiliar en cards, contraste. |

### Tipografía

| Uso | Fuente | Peso |
|-----|--------|------|
| Logo "Resender" | HK Grotesque Pro | Bold |
| Logo ".dev" | Space Mono | Bold |
| Headings (h1-h3) | HK Grotesque Pro | Bold |
| Body text | Inter (default de shadcn) | Regular / Medium |
| Código / snippets | Space Mono | Regular |

### Tono visual

- Basado en componentes de **shadcn/ui**.
- Estilo limpio, técnico pero accesible. Referencia visual: Resend.com, Linear, Vercel.
- Bastante espacio (whitespace generoso).
- Tipografía grande en hero.
- Componentes con bordes suaves (border-radius de shadcn por defecto).
- Sin elementos recargados ni exceso de gradientes.
- Las secciones de la landing pueden alternar entre el color de fondo base y cards/bloques elevados para separar visualmente (en light: crema y blanco; en dark: `#242029` y `#2e2a35`).

### Componentes shadcn requeridos

- `Button` — Primario (filled con primary color) y secundario (outline).
- `Card` — Para features, pricing tiers, blog posts.
- `Table` — Para comparación de pricing vs ManyChat.
- `Accordion` — Para FAQ.
- `NavigationMenu` — Navbar.
- `Badge` — Para categorías del blog ("Tutorial", "Actualización"), y badge "Recomendado" en pricing.
- `Tabs` — Si se necesita dentro de alguna sección.
- `Command` — Para búsqueda en docs (si se usa en el sitio principal también).

### Theming: Modo claro y modo oscuro

El sitio debe soportar dos temas visuales con un toggle/switch visible en la navbar para alternar entre ellos. Este switch es temporal (para evaluación interna entre los founders) y no estará en la versión pública final. El color de acento (`#7773a5` violeta) resalta en ambos modos.

#### Modo Claro (Light)

```css
--primary: #7773a5;
--primary-foreground: #ffffff;
--background: #f3ece0;
--foreground: #242029;
--secondary: #ffffff;
--secondary-foreground: #242029;
--muted: #ebe4d6;
--muted-foreground: #6b6780;
--accent: #7773a5;
--accent-foreground: #ffffff;
--card: #ffffff;
--card-foreground: #242029;
--border: #d4cfc7;
```

- Fondo general: crema (`#f3ece0`).
- Texto principal: dark (`#242029`).
- Cards y elementos elevados: blanco (`#ffffff`) sobre fondo crema.
- Botones, links, badges, highlights: violeta (`#7773a5`).

#### Modo Oscuro (Dark)

```css
--primary: #7773a5;
--primary-foreground: #ffffff;
--background: #242029;
--foreground: #f3ece0;
--secondary: #2e2a35;
--secondary-foreground: #f3ece0;
--muted: #35303d;
--muted-foreground: #a09bab;
--accent: #7773a5;
--accent-foreground: #ffffff;
--card: #2e2a35;
--card-foreground: #f3ece0;
--border: #3d3845;
```

- Fondo general: dark (`#242029`).
- Texto principal: crema (`#f3ece0`).
- Cards y elementos elevados: un tono ligeramente más claro que el fondo (`#2e2a35`).
- Botones, links, badges, highlights: violeta (`#7773a5`).

#### Implementación del switch

- Componente: toggle o switch de shadcn en la navbar (ícono de sol/luna o similar).
- Usar la clase `.dark` en el `<html>` (approach estándar de Tailwind + shadcn).
- Persistir preferencia en localStorage.
- **Nota:** Este switch es para evaluación interna. Una vez que se defina qué modo usar, se remueve el switch y se deja el modo elegido como fijo.

---

## 5. Requisitos funcionales

### Internacionalización (i18n)

- **Esquema:** Por ruta → `/en/...` y `/es/...`.
- Idioma por defecto: inglés (`/en`). La raíz (`/`) redirige a `/en`.
- Selector de idioma en la navbar (toggle o dropdown).
- Todo el contenido (landing, pricing, FAQ, blog, legal) debe existir en ambos idiomas.
- Los posts del blog tienen un campo `lang` en el frontmatter; se muestran en el listado del idioma correspondiente.

### Blog (MDX)

- Posts como archivos `.mdx` en el repositorio.
- Frontmatter para metadata (ver sección 3.3).
- Renderizado en build time con Next.js (SSG).
- Soporte para componentes React custom dentro de los posts (approach MDX estándar).
- Flujo: escribir `.mdx` → push al repo → deploy automático → post visible.
- Categorías: Tutorial, Actualización.

### Pagos (Stripe)

- Stripe Checkout integrado desde la página de Pricing.
- Cada plan tiene su botón que redirige al checkout de Stripe.
- Es una de las prioridades del lanzamiento (Arturo).

### Analytics

- PostHog integrado.
- No requiere trabajo especial en la spec del sitio más allá de incluir el script.

### Legal

- Privacy Policy y Terms of Service publicadas y accesibles.
- Requisito obligatorio de Meta para la aprobación de la app.

### Docs

- Subdominio: `docs.resender.dev`.
- Herramienta dedicada (Fumadocs, Nextra, o Mintlify).
- Búsqueda integrada.
- Sidebar con navegación por secciones.
- Contenido en inglés y español.

### SEO

- Meta tags (title, description, og:image) en todas las páginas.
- Los posts del blog deben tener meta tags generados desde el frontmatter.
- Sitemap generado automáticamente.
- RSS feed para el blog (opcional pero recomendado).

---

## 6. Stack técnico (resumen)

| Componente | Tecnología |
|------------|-----------|
| Framework | Next.js (App Router) |
| UI Components | shadcn/ui |
| Styling | Tailwind CSS (viene con shadcn) |
| Blog | MDX con frontmatter, renderizado en build time |
| Docs | Subdominio separado (Fumadocs / Nextra / Mintlify) |
| Pagos | Stripe Checkout |
| Analytics | PostHog |
| i18n | Rutas `/en` y `/es` |
| Deploy | Vercel |
| Tipografía logo | HK Grotesque Pro + Space Mono |
| Tipografía body | Inter |

---

## 7. Prioridades de lanzamiento

Basado en el documento de Lanzamiento, las prioridades (en negrita) son:

1. **Docs** (Arturo) — Documentación técnica en docs.resender.dev.
2. **Versión de la web en inglés** — i18n implementado.
3. **Conectar Stripe** (Arturo) — Pagos funcionando.
4. **Plantilla de n8n** — Ejemplo listo para que los usuarios arranquen rápido.
5. **Soporte** — Canal de Discord + email visibles.

Adicionales:
- Landing page completa con todas las secciones.
- Blog funcional con al menos 1-2 posts iniciales.
- Privacy Policy y Terms of Service publicadas.
- Conectar Google Tag Manager (o PostHog directo).
