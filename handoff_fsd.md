# Handoff: migrar `apps/web` a FSD correcto según la skill `nextjs-fsd`

**Fecha:** 2026-07-23
**Rama al momento del handoff:** `feat/cloudflare-opennext` (con cambios sin commitear de la migración a Cloudflare/OpenNext — NO mezclar ese trabajo con esta migración; hacer el trabajo FSD en una rama propia partiendo de `main` cuando la de Cloudflare se mergee, o coordinar con Arturo).

## Qué se hizo en la sesión anterior

Se creó la skill de proyecto **`nextjs-fsd`** (`.claude/skills/nextjs-fsd/`), basada exclusivamente en la documentación oficial de Feature-Sliced Design (`https://feature-sliced.design/llms-full.txt`, v2.1). Contiene:

- `SKILL.md` — reglas núcleo, algoritmo de decisión, antipatrones, checklist.
- `references/nextjs.md` — integración Next.js/FSD (capas `_app`/`_pages`, rutas finas, `api-routes`, `index.server.ts`, middleware en raíz, segmento `db`).
- `references/layers.md` — definición de capas, cross-imports, `@x`, slice groups, **y la guía oficial de adopción incremental "From a custom architecture"** (sección "Adopción incremental" — es el plan de migración a seguir).
- `references/examples.md` — ejemplos de código completos.

**No dupliques ese contenido: invoca la skill y léela.** Este handoff solo cubre lo que la skill no sabe: el estado real de `apps/web` y el orden de trabajo sugerido.

## Objetivo de la próxima sesión

Reorganizar `apps/web` para cumplir FSD tal como lo marca la skill.

## Estado actual de `apps/web` (NO cumple FSD)

Estructura en la raíz del paquete (sin `src/`), alias `@/*` → `./*` (`apps/web/tsconfig.json`), monorepo con `@workspace/ui` → `packages/ui/src/*`:

```
apps/web/
├── app/                  ← App Router de Next con rutas Y lógica mezcladas
│   ├── (auth)/ (product)/ api/{auth,meta,stripe}/ billing/ data-deletion/
│   ├── docs/ privacy/ terms/ waitlist/ layout.tsx page.tsx
├── components/           ← nombre por esencia (antipatrón): site-footer, theme-provider
├── features/             ← módulos de dominio: account, api-keys, auth, billing, connect-meta, connections
│   └── (semántica ≠ capa features de FSD; hay que reevaluar cada uno)
├── hooks/                ← vacío (antipatrón de nombre; eliminar)
├── lib/                  ← cajón de dominio+infra: account, api-keys, auth, billing, crypto,
│   │                        db.ts, inbound, messages, meta.ts, outbound, pages
├── types/                ← next-auth.d.ts (ambient)
├── db/migrations/        ← SQL de migraciones
└── auth.ts, middleware(¿?), next.config.ts, open-next.config.ts, wrangler.jsonc
```

Violaciones principales respecto a la skill: no hay capas ni slices; `components`/`hooks`/`types`/`lib` agrupan por esencia (desegmentación); las rutas de `app/` contienen lógica en vez de re-exports finos; no hay public APIs (`index.ts`) por módulo.

## Plan sugerido (orden de la guía oficial de adopción incremental, adaptado)

1. **Preparación:** crear `apps/web/src/`; reapuntar alias `@/*` → `./src/*` en `tsconfig.json` (verificar que `next.config.ts`, vitest y OpenNext no tengan rutas hardcodeadas a `lib/` etc.).
2. **Capas `_app` y `shared` primero:** mover providers/estilos/entrypoint-config a `src/_app/`; `lib/db.ts` → `shared/db`; `lib/crypto` → `shared/lib/crypto`; cliente(s) HTTP y llamadas a Meta/Stripe → `shared/api`; `auth.ts` e infraestructura de sesión → `shared/auth` (la skill lo manda ahí, no a una entity user); `types/next-auth.d.ts` → `_app/ambient/`.
3. **Pages first:** crear un slice en `src/_pages/` por cada ruta de `app/` ((auth) → sign-in, (product), billing, waitlist, docs, privacy, terms, data-deletion, home) y dejar `app/**/page.tsx|layout.tsx` como re-exports finos (`export { XPage as default } from '@/_pages/x'`).
4. **API routes:** mover la lógica de `app/api/{auth,meta,stripe}/**` al segmento `api-routes` de `src/_app/` y dejar `app/api/**/route.ts` como re-exports. Ojo: el webhook de Stripe y la ingesta inbound tienen tests (`lib/inbound/external-push.test.ts`, `lib/outbound/meta-send.test.ts`) — mover tests junto al código.
5. **Reevaluar `features/` y el resto de `lib/`:** por cada módulo, aplicar el algoritmo de la skill — solo es `features/` FSD si es una interacción reutilizada en varias páginas; si solo lo usa una página, se funde dentro del slice de esa página; dominio compartido (messages, inbound/outbound) puede acabar en `entities/` o `shared/api` según reuso real. No crear entities preventivamente.
6. **Public APIs:** `index.ts` por slice (sin `export *`); `index.server.ts` solo si aparecen errores server-only reales.
7. **Verificación:** `npx steiger src`, typecheck, tests de vitest, build de Next (y build de OpenNext si la rama Cloudflare ya está integrada). Checklist final de `SKILL.md`.

Hacerlo **incremental y en PRs pequeños** (la guía oficial lo permite explícitamente: brochazos primero, violaciones de imports se resuelven gradualmente). Confirmar con Arturo el alcance de cada PR antes de mover medio repo.

## Restricciones y contexto del proyecto

- Memoria del proyecto: **Arturo hace la infra, Claude solo código** (checklist en `docs/cloudflare-infra-checklist.md`). La migración FSD es solo código, pero no toques wrangler/despliegues.
- Trabajo Cloudflare/OpenNext en vuelo: ver `handoff_cloudflare.md` en la raíz del repo. Evitar conflictos: la migración FSD moverá los mismos archivos que esa rama modifica (`lib/inbound`, `lib/outbound`, `app/api/...`). **Secuenciar después del merge de `feat/cloudflare-opennext`.**
- PRs contra `main`.

## Skills sugeridas para la próxima sesión

1. **`nextjs-fsd`** — obligatoria; invocarla al inicio y seguirla como fuente de verdad (incluye la guía de migración incremental en `references/layers.md`).
2. **`apply-prd`** — si Arturo formaliza la migración como ticket/PRD, usarla para ejecutar de extremo a extremo con commit/PR.
3. **`simplify`** y **`/code-review`** — al cierre de cada PR de migración.
4. **`stripe-best-practices`** — solo si al mover `app/api/stripe/` o `lib/billing` se toca lógica de Stripe (no solo ubicación).
