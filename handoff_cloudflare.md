# Handoff — Migración a Cloudflare (Workers + OpenNext)

> Documento de traspaso para continuar el trabajo en una sesión nueva.
> Contexto: conversación de arquitectura del 2026-07-21 entre Arturo y Claude.
> Objetivo de la próxima sesión: **implementar la migración a Cloudflare** siguiendo las decisiones ya tomadas aquí.

## Qué es este proyecto

`resender` es un **gateway de mensajería de Meta (Facebook Messenger)**, NO tiene nada que ver con email/Resend. Monorepo Turborepo (npm workspaces), una sola app desplegable: `apps/web` (Next.js 16.2.6, App Router, React 19). Base de datos Postgres en **Neon**. Billing con Stripe. Auth con NextAuth v5 beta (Credentials + JWT, sin sesiones en DB).

Los **dos flujos críticos del producto** (definidos por Arturo — esto es lo que importa, el resto es secundario):

1. **Entrada:** Meta manda mensaje → `app/api/meta/webhook` → persistir en Neon → **reenviar a la URL de webhook que configuró el usuario**.
2. **Salida:** el sistema del usuario llama a nuestro endpoint (`app/api/meta/send`, autenticado con API keys de `lib/api-keys/tokens.ts`) → nosotros lo mandamos al Send API de Meta y devolvemos el resultado **síncronamente**.

## Decisiones tomadas (NO re-litigar)

| Decisión | Detalle |
|---|---|
| **Migrar a Cloudflare Workers vía OpenNext** (`@opennextjs/cloudflare`) | Verificar matriz de compatibilidad con Next 16 antes de empezar. |
| **Neon se queda** como base de datos | Única fuente de verdad compartida. |
| **SIN Durable Objects en fase 1** | Arturo decidió explícitamente que el tiempo real en el dashboard NO importa. Con recargar la página basta. |
| **Borrar el SSE y el store en memoria** | Eliminar `apps/web/lib/message-store.ts` y `apps/web/app/api/meta/events/route.ts`. Eran la única razón para DOs y no funcionan en Workers (isolates no comparten memoria). |
| **Sin Cloudflare Queues por ahora** | A ~500 msgs/día, `ctx.waitUntil()` + reintentos + log en Neon es suficiente. Queues se agrega después sin rediseño porque la tabla de entregas ya existirá. |
| **Todo en el Worker de OpenNext en fase 1** | La separación en un Worker `apps/gateway` dedicado (con `packages/core` compartido y Service Bindings) es el plan de escala futuro, no de esta fase. |
| **Dominio `resender.dev` se queda registrado en Hostinger** | Solo se cambian los **nameservers** a Cloudflare (Add site → plan Free → cambiar NS en Hostinger). No transferir el registro ahora. |
| **Plan Workers Paid ($5/mes)** | Sobra capacidad (10M req/mes incluidos vs ~100k estimados). |

## Cambios técnicos obligatorios (en orden)

1. **Seguridad primero:** `apps/web/.env` está en el repo con secretos → sacarlo (`.gitignore`) y **rotar todas las llaves** (Stripe, Meta, AUTH_SECRET, TOKEN_ENCRYPTION_KEY, DATABASE_URL). En Workers los secretos van vía `wrangler secret`.
2. **Driver de DB:** `apps/web/lib/db.ts` usa `postgres` (postgres.js, TCP crudo, `max: 10`) → cambiar a **`@neondatabase/serverless`** con el connection string *pooled* de Neon. Ya está `prepare: false`, el cambio es casi mecánico. Hacerlo primero: funciona igual en local y desbloquea todo lo demás.
3. **OpenNext + wrangler** para `apps/web`. Todas las rutas ya declaran `runtime = "nodejs"` (compatible con `nodejs_compat`). Sin middleware, sin ISR, sin `next/image` — nada exótico que portar.
4. **Stripe webhook** (`app/api/stripe/webhook/route.ts`): cambiar `constructEvent` → **`constructEventAsync`** (WebCrypto). Validar el resto de `node:crypto` bajo `nodejs_compat`: scrypt (`lib/auth/password.ts`), AES-256-GCM (`lib/crypto/encryption.ts`), HMAC (`lib/api-keys/tokens.ts`). El scrypt consume CPU del Worker — probarlo.
5. **Rediseñar el flujo de entrada:** responder 200 a Meta rápido y hacer el reenvío al webhook del usuario dentro de `ctx.waitUntil()`, con 1–2 reintentos.
6. **Migraciones:** `apps/web/scripts/migrate.mjs` (runner propio, SQL plano en `apps/web/db/migrations/`, tabla `_echo_migrations`) se queda como paso de deploy en Node — no corre en el Worker, no cambia.
7. **CI/CD (no existe nada hoy — cero workflows):** GitHub Actions con turbo (`lint → typecheck → test → build`) en PRs; `wrangler deploy` en merge a main; previews por PR con `wrangler versions upload`; considerar Neon branching por PR.

## Requisitos de calidad de producto (acordados con Arturo)

Estos convierten el gateway en un producto confiable, no solo funcional:

- **Delivery log:** tabla en Neon con el resultado de cada entrega al webhook del usuario (`delivered`/`failed`, código HTTP, timestamp, reintentos). Visible en el dashboard, estilo el log de webhooks de Stripe. Los endpoints de los usuarios VAN a fallar; no perder mensajes en silencio.
- **Mensajes entrantes y salientes en la misma tabla** con columna de dirección (`inbound`/`outbound`) → el dashboard muestra la conversación completa con una sola estructura.
- **Errores de Meta traducidos, no tapados:** el endpoint de salida debe devolver el motivo real (token expirado, ventana de 24h de Messenger cerrada, usuario bloqueó la página) — la ventana de 24h será el error más común. Nada de 500 genéricos.
- **Idempotencia en el endpoint de salida:** header `Idempotency-Key` opcional + columna única en Neon; si llega repetido, no reenviar a Meta. Retrofitearlo después es doloroso.
- **Dashboard sin tiempo real:** server components leyendo de Neon en cada carga. Opcional cosmético: botón refrescar o `router.refresh()` periódico.

## Estado actual del repo

- Branch `main` limpio; sin config de deploy (no hay `wrangler.toml`, ni `vercel.json`, ni Dockerfile, ni `.github/`).
- Documentos relacionados en la raíz: `HANDOFF.md` (traspaso anterior, otro tema), `CONTEXT.md`, `prd_*.md` (PRDs de features), `docs/`.
- Rutas API existentes: `app/api/{stripe/webhook, auth/[...nextauth], meta/{webhook,start,callback,send,events}}`.
- Server actions en `apps/web/features/{api-keys,connections,account,auth,billing}/actions.ts`.

## Skills sugeridos para la próxima sesión

- `apply-prd` — si se formaliza esta migración como PRD/ticket, implementarla de extremo a extremo con este flujo.
- `stripe-best-practices` — al tocar el webhook de Stripe (`constructEventAsync`) y validar el flujo de billing post-migración.
- `stripe-docs` — para consultar la referencia de webhooks/API de Stripe.
- `security-review` — antes del PR final: se tocan secretos, auth, crypto y endpoints públicos.
- `simplify` / `review` — limpieza y revisión del diff de la migración.

## Pendientes / verificaciones abiertas

- [ ] Confirmar compatibilidad de `@opennextjs/cloudflare` con Next 16.2.x (o fijar la versión de Next que soporte).
- [ ] Probar scrypt/AES/HMAC bajo `nodejs_compat` en un Worker real antes de cortar tráfico.
- [ ] Auditar que OpenNext resuelva todos los `process.env.*` usados en runtime.
- [ ] Stripe: reenviar webhooks al nuevo endpoint con Stripe CLI para validar end-to-end; considerar fijar `apiVersion` en `lib/billing/stripe.ts` (hoy no está pineado).
- [ ] Cambiar nameservers en Hostinger y verificar zona activa antes de asignar Custom Domains a los Workers.
