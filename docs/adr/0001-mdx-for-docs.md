# Render the public `/docs` section with MDX

**Status:** accepted

We needed a public `/docs` page documenting the integration flow, and we expect it to grow into a multi-page docs section rather than stay a single page. We chose `@next/mdx` so docs are authored in Markdown (`app/docs/*.mdx`) with the option to embed React components, styled via `@tailwindcss/typography` (`prose`). This is a deliberate deviation: every other public page (`privacy`, `terms`, `data-deletion`) is hand-written TSX, so a reader would otherwise wonder why MDX machinery exists for one page — the answer is that docs are expected to expand.

## Considered Options

- **Hand-written TSX** (matches the existing legal pages, zero deps) — rejected: poor authoring ergonomics for long-form, growing docs.
- **`react-markdown` + `remark-gfm`** (2 deps, no global config, contained to the page) — rejected: runtime string parsing and no first-class `.mdx`-as-route; weaker fit for a growing docs section.
- **`@next/mdx`** (chosen) — official App Router path; `.mdx` files become routes.

## Consequences

- Adds app-wide config: `pageExtensions` + `withMDX()` in `next.config.ts`, and a **required** root `mdx-components.tsx`. This config is global, not scoped to `/docs`.
- Adds `@tailwindcss/typography`; MDX output is otherwise unstyled. In Tailwind v4 it is registered via `@plugin "@tailwindcss/typography"` in the global CSS (consumed through `@workspace/ui`), not a JS config.
