# ADR 0012 — Un solo Worker: Next se queda con todo y se borra `apps/api`

- **Estado:** aceptado
- **Fecha:** 2026-08-21
- **Supera a:** `docs/phase-1-api-migration.md` y `docs/phase-2-api-migration-frontend.md`, que quedan como histórico

## Contexto

El repo venía con dos aplicaciones: `apps/web` (Next sobre OpenNext, el producto
que corre en producción) y `apps/api` (Worker Hono con API pública `/v1`,
OpenAPI, entrypoint RPC, Queues y DLQ). El plan escrito era migrar el frontend a
consumir `api` por Service Binding y dejar a `web` sin acceso a la base.

Al medirlo, el estado real era este:

- `apps/api` **nunca se desplegó desde CI**. Ni `deploy.yml` ni
  `deploy-staging.yml` lo mencionan.
- **Nada lo llamaba.** Cero referencias desde `web`, sin Service Binding en
  `apps/web/wrangler.jsonc`.
- `packages/contracts` lo consumía **únicamente** `apps/api`.
- 8.550 líneas de producción + 4.817 de tests, mantenidas como espejo a mano:
  sus 8 commits son todos commits compartidos con `web`.
- El espejo **ya se había roto**: cero menciones a adjuntos (migración 0016, 15
  archivos en `web`), sin labels de Inbox ni permiso de Instagram. Las reglas de
  plan (`50_000` mensajes, `maxPages`) estaban duplicadas en dos archivos.

## Decisión

**No se separa el backend de Next. Se borra `apps/api` y `packages/contracts`.**

El argumento clásico para separar —que el backend escale aparte del frontend— no
aplica en Cloudflare: los dos son Workers, mismo runtime, mismo autoescalado por
isolate. Partir un Worker en dos no compra throughput; agrega un salto por
operación.

Con 200 webhooks/día por cliente, 10.000 tenants son ~185 req/s en pico. Workers
no lo registra. Lo que sí se satura antes es la base: a 6 queries por evento, ese
mismo pico son ~1.100 queries/s contra Neon. **La separación empeora ese número**,
porque le suma un salto de red o RPC a cada una.

El único muro propio de Next en esta plataforma es el **tamaño del bundle**: 10 MB
gzip. El build de este ADR da 5,8 MB, contra 3,96 MB de julio. Cuando se acerque
al techo, el corte correcto es **sacar marketing y blog** (shiki, MDX, contenido)
a su propio Worker, no sacar la API de Next.

## Lo que sí se rescató antes de borrar

`apps/api` tenía tres cosas que producción **no** tenía, y que no dependían de la
separación:

1. **Entrega durable.** `web` reintentaba 3 veces en ~4 s dentro de `after()`, que
   tiene techo de 30 s: un endpoint caído un minuto perdía el evento. Portado con
   Queue, DLQ y cron de recuperación.
2. **Firma del push.** Pendiente, con la generación y rotación del secreto.
3. La tabla `external_webhook_jobs` y `connected_pages.webhook_signing_secret_encrypted`,
   que ya estaban migradas en producción y no las escribía nadie.

Al portar la entrega **no se portó el payload**: `apps/api` lo armaba con
`jsonb_build_object` y con otra forma (`{id, type: "message.received", data}`),
mientras producción manda `{type: "message", tenant, page, conversation, message}`.
Ese es el contrato documentado y el que se conservó.

## Consecuencias

- Un cambio de precio, de regla o de payload se escribe **una vez**.
- La API pública sigue siendo la de `apps/web` (`/api/meta/send` y las rutas de
  Instagram), autenticada con API key opaca.
- Los Workers `api` y `api-staging` se borraron de la cuenta de Cloudflare. Era
  obligatorio: eran los **dueños del consumidor** de `webhook-deliveries` y
  `webhook-deliveries-staging`, y una cola de Cloudflare admite un solo
  consumidor, así que `web` no podía tomarlo mientras existieran.
- El diseño queda recuperable en el tag `arquitectura/api-worker-phase-1`.

## Cuándo revisar esta decisión

No por cantidad de usuarios — ese eje no aparece. Sí por cualquiera de estos:

1. Un **segundo consumidor del backend** que no sea el Next: app móvil, un
   partner, WhatsApp como superficie propia.
2. Una **segunda persona escribiendo backend**, o alguien a quien no se le quiera
   dar `DATABASE_URL` ni `META_APP_SECRET`.
3. `/v1` como **superficie contratada**, con clientes integrados y promesa de
   versionado.
4. El **acoplamiento de deploy doliendo**: el día que no se quiera tocar un copy
   de la landing por no redesplegar el camino de webhooks.

Ninguno se cumplía al escribir esto.
