# Handoff — Resender: Guía actual para Meta App Review

> **Propósito:** Que un agente nuevo continúe el trabajo de llevar la app **Resender** (canal Messenger) a aprobar **Meta App Review** para `pages_messaging`.
> **Fecha del análisis original:** 2026-06-17 · **Actualización:** 2026-06-21 · **Repo:** `/Users/arturo/git/resender` · **Branch:** `codex/meta-review-webhook-hygiene`
> **Idioma de trabajo del usuario:** Español.

---

## 1. Contexto en una frase

Resender es un **gateway + bitácora** para Facebook Messenger (multi-tenant, Next.js en `apps/web`): recibe webhooks de Meta, persiste conversaciones/mensajes, los reenvía al `webhookUrl` externo del tenant (N8N/IA) y permite responder vía API con una API key opaca. **NO es un bot conversacional con UI propia** — las respuestas llegan desde el sistema externo del cliente. Esto es central para entender el riesgo de revisión (sección 5).

## 2. Estado: qué se analizó y conclusión

Se hizo una **auditoría real del código** (no de los PRDs) cruzada contra requisitos de Meta App Review para Messenger y contra el estado actual del repo.

**Veredicto: ⚠️ Aún no enviaría a App Review.** El núcleo técnico está mejor cubierto y esta rama cierra dos riesgos de higiene: `webhookUrl` insegura y desconexión sin desuscribir en Meta. Lo que queda es principalmente preparación de revisión: cuenta/demo end-to-end, configuración del panel Meta y Terms de Servicio.

- **Solo Messenger está implementado.** Instagram (`prd_instagram.md`) es **solo plan, NO existe en código** (sin `lib/instagram.ts`, sin rutas `app/api/instagram/*`, sin migración `0002`, sin columna `channel`). → **No solicitar permisos `instagram_business_*` en la revisión.**
- Los permisos van en el `config_id` de **Facebook Login for Business** (`NEXT_PUBLIC_META_CONFIG_ID`), **no en el código**. Confirmar en el panel que pide exactamente `pages_messaging`, `pages_manage_metadata`, `pages_show_list` y nada más.

## 3. Lo que YA cumple (no tocar, está bien)

| Requisito Meta | Evidencia en código |
|---|---|
| Webhook responde **200 OK ≤20 s** | `apps/web/app/api/meta/webhook/route.ts` — responde 200 y difiere push con `after()` |
| Verificación de firma **X-Hub-Signature-256** | mismo archivo — HMAC-SHA256 con `META_APP_SECRET`, `timingSafeEqual` |
| Verificación del reto (GET `hub.challenge`) | mismo archivo |
| **Cifrado de tokens en reposo** | `apps/web/lib/crypto/encryption.ts` (AES-256-GCM) |
| Token nunca viaja al cliente | `apps/web/app/api/meta/callback/route.ts`, `lib/pages/page-registry.ts` |
| No pide credenciales de Meta a usuarios | OAuth correcto (`apps/web/lib/meta.ts`) |
| Datos por tenant separados (Tech Provider) | `tenant_id` en todas las tablas (`apps/web/db/migrations/0001_mvp_foundation.sql`) |
| Endpoint de envío autenticado | `apps/web/app/api/meta/send/route.ts` — API key Bearer, hash SHA-256 |
| Política de privacidad pública | `apps/web/app/privacy/page.tsx` |
| Instrucciones públicas de eliminación de datos | `apps/web/app/data-deletion/page.tsx` |
| Borrado self-serve de cuenta y tenant | `apps/web/features/account/ui/delete-account-panel.tsx`, `apps/web/features/account/actions.ts`, `apps/web/db/migrations/0002_account_deletion_cascade.sql` |
| Contacto público de privacidad/seguridad | `info@resender.dev` en `/privacy` y footer público |
| `webhookUrl` segura para destinos reales | `apps/web/lib/pages/webhook-url.ts` exige HTTPS; HTTP solo queda para localhost en desarrollo |
| Defensa de push ante URLs antiguas inseguras | `apps/web/lib/inbound/external-push.ts` vuelve a validar antes de hacer `fetch` |
| Desconexión de Page intenta desuscribir en Meta | `apps/web/features/connections/actions.ts` llama `unsubscribeFromWebhook()` best-effort |

## 4. ❌ Lo que FALTA — la guía de verificación de Meta

### 🔴 BLOQUEADORES OBLIGATORIOS (sin esto, rechazo automático)

1. **Cuenta de prueba para el revisor** — la app está detrás de login propio. Entregar usuario/contraseña temporales y explicar que la cuenta ya está preconfigurada.
2. **Demo end-to-end automatizada** — el revisor debe poder mandar un DM a la Page demo y recibir respuesta automática vía el sistema externo conectado a Resender.
3. **Screencast final** — grabar login en Resender, Page conectada, DM entrante, push al sistema externo, respuesta por `/api/meta/send` y mensaje saliente en Messenger.

### 🟠 OBLIGATORIOS / FUERTEMENTE RECOMENDADOS

4. **Términos de Servicio para los tenants** — como **Proveedor de tecnología** conviene prohibir por contrato usos indebidos a tus clientes. En este checkout aún no existe `apps/web/app/terms/page.tsx`.
5. **Ajustes del panel** (acción del usuario, no código): app icon **1024×1024** sin logos de marca, categoría precisa, email de notificaciones en "Todas las notificaciones excepto…", publicar la **página de Facebook** asociada.
6. **URLs legales en el panel**: confirmar que Meta apunta a `https://resender.dev/privacy` y a `https://resender.dev/data-deletion`.

### 🟡 RECOMENDADOS (suman puntos, no bloquean)

7. Procesar botón **"Empezar"** + mensaje de bienvenida (hoy se suscribe `messaging_postbacks` pero no se procesa) — `apps/web/lib/meta.ts` suscribe `messages,messaging_postbacks`.
8. **Texto de saludo** (greeting, vía API/panel).
9. Suscribir el evento **`messaging_policy_enforcement`** (avisa de infracciones de política) — añadir a los `subscribed_fields` en `lib/meta.ts`.
10. Manejo del **error 190** (token caduco) con notificación al admin (hoy se persiste el error pero no se notifica).

## 5. ⚠️ RIESGO PRINCIPAL — modelo de producto (leer sí o sí)

La guía de Meta asume una **experiencia interactiva de Messenger** (bot que responde). Resender reenvía a un sistema externo y responde **vía API**. **El revisor enviará un mensaje y esperará respuesta**; si la cuenta de prueba no tiene una automatización conectada respondiendo, verá silencio → **rechazo**.

**Mitigación obligatoria para el envío:** dejar una **automatización de demo** (N8N o similar) conectada que responda automáticamente a cualquier DM, y documentar en las notas: *"envía la palabra X → recibirás respuesta automática"*. El **screencast** debe mostrar: login con Facebook for Business → llega un DM → respuesta automática end-to-end.

## 6. Cambios cerrados en esta rama

1. `webhookUrl` ahora exige HTTPS para destinos reales. En desarrollo se permite HTTP solo para `localhost`, `127.0.0.1` y `::1`.
2. El push externo vuelve a validar la `webhookUrl` antes de hacer `fetch`, para proteger contra URLs antiguas en base de datos.
3. Al desconectar una Page, Resender conserva el historial local y además intenta desuscribir la Page del webhook de Meta con `DELETE /{page_id}/subscribed_apps` vía `unsubscribeFromWebhook()`.
4. La decisión de dominio quedó documentada en `CONTEXT.md`.

## 7. Plan de acción sugerido (orden recomendado)

**Código (lo hace el agente):**
1. Crear página `/terms` y enlazarla desde el footer si se quiere que Terms quede visible públicamente.
2. (Recomendado) Procesar "Empezar" / postbacks o asegurar que la demo no dependa de Get Started.
3. (Recomendado) Suscribir `messaging_policy_enforcement`.
4. (Recomendado) Mostrar alerta operativa cuando Meta devuelva error 190 / token inválido.

**Usuario (panel/manual):**
5. Publicar privacy URL en el panel, app icon 1024×1024, categoría, email de notificaciones.
6. Publicar la página de Facebook.
7. Conectar automatización de demo que responda + preparar credenciales/frase de activación para el revisor.
8. Grabar screencast (login → DM entrante → respuesta automática) y escribir el caso de uso de `pages_messaging` (individual, sin copiar-pegar).

## 8. Artefactos de referencia (no duplicar — abrir si hace falta)

- `prd_mvp.md` — alcance del MVP de Messenger (ya implementado). App review estaba marcado *Out of Scope* (línea 144).
- `prd_instagram.md` — plan de Instagram (NO implementado). Su sección "Paso 8" describe el App Review de Instagram para referencia futura.
- `CONTEXT.md` — glosario canónico del producto (tenant, ownership, API keys, etc.).
- `README.md` — variables de entorno y comandos de validación (`npm run lint/typecheck/test:run/build`).
- Código clave: `apps/web/app/api/meta/{start,callback,webhook,send}/route.ts`, `apps/web/lib/meta.ts`, `apps/web/lib/crypto/encryption.ts`, `apps/web/lib/pages/page-registry.ts`, `apps/web/db/migrations/0001_mvp_foundation.sql`.

## 9. Notas / gotchas

- developers.facebook.com es una SPA JS → **WebFetch no lee el cuerpo**, solo navegación. Pedir al usuario que pegue el texto, o usar WebSearch.
- Ya existe la migración `0002_account_deletion_cascade.sql`; ejecutarla en entornos que todavía no tengan el borrado cascada.
- Repo sin tests previos antes del MVP; seguir el patrón de testing que defina `prd_mvp.md`.
- NO hay secretos que redactar en este doc; las credenciales viven en `.env` (no versionado) y nunca se mostraron en el chat.

## 10. Skills sugeridas para la próxima sesión

- **`spec-drafter`** (`/spec-drafter`) — antes de implementar privacy/data-deletion/terms, pasar el plan como spec para obtener mapa del codebase + Gherkin + criterios de aceptación. Invocación manual.
- **`find-docs`** — para la API/forma exacta del **Data Deletion Callback** de Meta y de la *Greeting/Get Started* (Messenger Profile API). No confiar en memoria.
- **`next-best-practices`** — al crear las rutas `/privacy`, `/terms` y el route handler `/api/meta/data-deletion` (convenciones de App Router, route handlers, metadata).
- **`verify`** (`/verify`) o **`run`** (`/run`) — para probar el endpoint de borrado y el flujo end-to-end localmente antes de grabar el screencast.
- **`code-review`** (`/code-review`) — revisar el diff de las piezas nuevas (sobre todo la validación del `signed_request` del callback de borrado) antes de hacer push.
- **`documenter`** — si el usuario quiere registrar la decisión de cumplimiento/compliance como ADR o en el roadmap del proyecto.
