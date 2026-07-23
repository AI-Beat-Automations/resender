---
name: nextjs-fsd
description: Organiza código Next.js con Feature-Sliced Design (FSD). Usar al crear, mover o revisar archivos de la app web - para decidir en qué capa/slice/segmento va cada pieza de código, cablear rutas de Next (carpeta app/) hacia las páginas FSD (src/_pages), definir public APIs y resolver dudas de imports entre módulos.
---

# Next.js + Feature-Sliced Design

Skill basada exclusivamente en la documentación oficial de FSD (<https://feature-sliced.design/llms-full.txt>, v2.1). Aplica sus reglas tal cual; cuando necesites más detalle, lee los archivos de `references/`:

- `references/nextjs.md` — integración completa con Next.js: App Router, Pages Router, Route Handlers, middleware, public APIs server/client.
- `references/layers.md` — definición detallada de cada capa, criterios de decisión, slice groups, cross-imports y notación `@x`.
- `references/examples.md` — ejemplos de código completos: slice de página, shared/api, TanStack Query, auth, DTOs y mappers.

## Conceptos base

FSD organiza el código en una jerarquía de tres niveles:

1. **Layers** (capas, nombres estandarizados, de arriba hacia abajo):
   `app` → `pages` → `widgets` → `features` → `entities` → `shared`
   (la capa `processes` está deprecada — no usarla). No es obligatorio usar todas: la mayoría de los proyectos empieza solo con `app`, `pages` y `shared`.
2. **Slices**: carpetas dentro de una capa que dividen el código por dominio de negocio (`feed`, `sign-in`, `article-read`…). Nombres libres, definidos por el negocio. **`app` y `shared` NO tienen slices** — se dividen directamente en segmentos.
3. **Segments**: carpetas dentro de un slice que agrupan por propósito técnico:
   - `ui` — todo lo relacionado con mostrar UI: componentes, formatters, estilos.
   - `api` — interacción con backend: request functions, data types, mappers.
   - `model` — el modelo de datos: schemas, interfaces, stores, lógica de negocio.
   - `lib` — código de librería que otros módulos del slice necesitan.
   - `config` — configuración y feature flags.

Los nombres de segmento deben describir **el propósito (el porqué), no la esencia (el qué)**. Nombres como `components`, `hooks`, `types`, `utils`, `helpers` están prohibidos como segmentos: obligan a excavar en cada archivo y agrupan código no relacionado.

## Las dos reglas que nunca se rompen

**1. Regla de imports entre capas:**

> Un módulo (archivo) de un slice solo puede importar otros slices que estén en capas estrictamente inferiores.

- `pages/feed` puede importar de `widgets`, `features`, `entities`, `shared` — nunca de otra página ni de `app`.
- Un slice no puede importar de otro slice de su misma capa (una feature no importa otra feature). La composición de slices hermanos se hace desde una capa superior (la página compone las features).
- Excepción: `app` y `shared` no tienen slices, por lo que sus segmentos pueden importarse libremente entre sí.

**2. Regla de public API:**

> Todo slice (y todo segmento de las capas sin slices) debe tener una definición de public API (index). Los módulos externos solo pueden referenciar la public API, nunca la estructura interna del slice/segmento.

- Public API = `index.ts` con re-exports explícitos. **Nunca `export *`** (rompe la descubribilidad y expone internals).
- Dentro del mismo slice: imports **relativos** con ruta completa (`../api/loader`). Entre slices distintos: imports **absolutos** con alias (`@/…`). Esto previene imports circulares vía el index.
- En `shared/ui` y `shared/lib`, usar un index **por componente/librería** (`shared/ui/button/index.ts`), no un mega-index de todo `shared/ui` — evita bundles grandes y tree-shaking roto.
- No crear index adicionales dentro de los segmentos de capas con slices (p. ej. NO `features/comments/ui/index.ts` si ya existe `features/comments/index.ts`).

## Next.js: la fricción con `app/` y la solución oficial

Next.js reserva `app/` (App Router) y `pages/` (Pages Router), que chocan con las capas `app` y `pages` de FSD. La solución estándar documentada oficialmente:

1. **Renombrar las capas FSD** `app` → `_app` y `pages` → `_pages`, **independientemente del router usado**. Es compatible con el linter oficial (Steiger).
2. **Dejar las carpetas de Next en la raíz del proyecto** (fuera de `src/`), de modo que `src/` contenga solo código FSD. La carpeta `app/` de Next queda reducida a archivos de ruta *finos* que solo re-exportan desde `src/`.

```
app/                        ← carpeta app de Next (solo routing)
├── api/
│   └── get-example/
│       └── route.ts        ← re-exporta desde src/_app/api-routes
└── example/
    └── page.tsx            ← re-exporta desde src/_pages/example
src/
├── _app/                   ← capa app de FSD (providers, api-routes, estilos globales)
│   └── api-routes/
├── _pages/                 ← capa pages de FSD (la estructura real de páginas)
│   └── example/
│       ├── index.ts
│       └── ui/
│           └── example.tsx
├── widgets/
├── features/
├── entities/
└── shared/
```

El archivo de ruta solo re-exporta:

```tsx
// app/example/page.tsx
export { ExamplePage as default, metadata } from '@/_pages/example';
```

Route Handlers: la lógica vive en el segmento `api-routes` de la capa `_app`, y `app/api/**/route.ts` solo re-exporta:

```tsx
// app/api/example/route.ts
export { getExampleData as GET } from '@/_app/api-routes';
```

Reglas adicionales de la guía oficial:

- `middleware.ts` e `instrumentation.ts` van en la raíz del proyecto, junto a las carpetas `app`/`pages` de Next.
- Si exportar un módulo server-only desde `index.ts` contamina el grafo de módulos cliente (errores de build con `server-only`), añade un **`index.server.ts`** como public API separada para Server Components y funciones de acceso a datos server-only.
- Queries a base de datos: segmento `db` en la capa `shared` (`shared/db`); la lógica de caching/revalidación se mantiene junto a las queries.
- FSD es principalmente para frontend: si necesitas muchos endpoints, considera separarlos en otro paquete del monorepo.

Detalle completo (incl. Pages Router) en `references/nextjs.md`.

## Algoritmo: ¿dónde va este código?

Modelo mental v2.1 — **pages first**: empieza por las páginas y quédate ahí si puedes. La descomposición hacia capas inferiores se hace **después**, cuando la reutilización real aparece, no de forma preventiva.

1. **¿Es una página o parte de una sola página?** → `_pages/<slice>`. No hay límite de cuánto código puede vivir en un slice de página; un bloque de UI no reutilizado se queda dentro de la página. Páginas muy similares (login/registro) pueden compartir slice.
2. **¿Es un bloque grande y autosuficiente de UI reutilizado en varias páginas** (o una página con varios bloques grandes independientes)? → `widgets/<slice>`. Si el bloque es el contenido principal de una página y no se reutiliza, **no** es un widget: va dentro de la página.
3. **¿Es una interacción con valor de negocio reutilizada en varias páginas?** → `features/<slice>`. **No todo necesita ser feature**: el indicador es la reutilización. Demasiadas features ahogan a las importantes.
4. **¿Es un concepto de negocio del mundo real (User, Post, Order) con lógica reutilizada?** → `entities/<slice>`. Precauciones: un cliente "thin" puede no necesitar esta capa; el CRUD simple va en `shared/api`, no en entities; los datos de autenticación (token, usuario actual) van en `shared/auth`/`shared/api`, no en una entity `user`.
5. **¿Es infraestructura o código desacoplado del negocio?** → `shared/<segmento>` (`api`, `ui` (UI kit), `lib`, `config`, `routes`, `i18n`…). Shared se extrae durante el desarrollo, no se planifica por adelantado.
6. **¿Concierne a toda la aplicación** (providers, router, estilos globales, analytics, entrypoints)? → `_app/<segmento>`.

Dentro del slice, elegir segmento por propósito: fetch/mutations → `api`; componentes y formatters → `ui`; schemas de validación, stores y lógica de negocio → `model`; configuración/flags → `config`.

## Antipatrones a detectar y corregir

- **Desegmentación**: carpetas `components/`, `utils/`, `hooks/`, `constants/` agrupando por tipo técnico en lugar de por dominio; archivos genéricos `types.ts`/`utils.ts`/`helpers.ts` que mezclan dominios. Corregir nombrando por dominio (`model/delivery.ts`, `model/user.ts`).
- **Cross-imports** (slice importa a un hermano de su capa): code smell. Estrategias en orden: (A) fusionar slices que siempre cambian juntos; (B) bajar el flujo de dominio compartido a `entities`; (C) componer desde arriba (la página inyecta con render props/children); (D) si es inevitable, solo vía public API explícita. La notación `@x` (`entities/A/@x/B.ts`) es **solo para entities** y como último recurso. Ver `references/layers.md`.
- **Entities excesivas**: no crear una entity por cada trozo de lógica; preferir descomposición diferida (el código empieza en el `model` de la página).
- **`shared/types` o segmento `types`**: prohibido — agrupa por esencia, no por propósito. Los tipos viven junto al código que los usa (DTOs junto a las request functions, props junto al componente).
- **Dump de helpers en `shared/lib`**: cada librería interna tiene un área de foco documentada (dates, colors, text…), no un cajón de sastre.
- **Assets en un segmento `assets` global**: los assets siguen las mismas reglas que el código — junto a quien los usa; en `shared/ui` solo si se reutilizan; globales (fuentes, CSS reset) en la capa app.

## Herramientas oficiales

- **Steiger** (linter de arquitectura FSD): `npx steiger src`. Reglas clave: `insignificant-slice` (sugiere fusionar entity/feature usada por una sola página) y `excessive-slicing`.
- **FSD CLI** (generador de carpetas): `npx fsd pages feed --segments ui api`, `npx fsd shared --segments api config`.

## Checklist al terminar cualquier cambio

1. Ningún import apunta a una capa igual o superior (salvo dentro de `_app`/`shared` entre segmentos, o `@x` documentado en entities).
2. Ningún import externo entra a la estructura interna de un slice (solo a su `index.ts` / `index.server.ts`).
3. Los archivos de ruta de Next (`app/**/page.tsx`, `app/api/**/route.ts`, `middleware.ts`) contienen solo re-exports/composición mínima; la lógica vive en `src/`.
4. Ningún segmento ni archivo con nombre por esencia (`components`, `hooks`, `types`, `utils`).
5. Los index no usan `export *`.
