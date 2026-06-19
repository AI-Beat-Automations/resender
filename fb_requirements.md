# Handoff — Resender: Guía de lo que falta para la verificación de Meta App Review

> **Propósito:** Que un agente nuevo continúe el trabajo de llevar la app **Resender** (canal Messenger) a aprobar **Meta App Review** para `pages_messaging`.
> **Fecha del análisis:** 2026-06-17 · **Repo:** `/Users/arturo/git/resender` · **Branch:** `main`
> **Idioma de trabajo del usuario:** Español.

---

## 1. Contexto en una frase

Resender es un **gateway + bitácora** para Facebook Messenger (multi-tenant, Next.js en `apps/web`): recibe webhooks de Meta, persiste conversaciones/mensajes, los reenvía al `webhookUrl` externo del tenant (N8N/IA) y permite responder vía API con una API key opaca. **NO es un bot conversacional con UI propia** — las respuestas llegan desde el sistema externo del cliente. Esto es central para entender el riesgo de revisión (sección 5).

## 2. Estado: qué se analizó y conclusión

Se hizo una **auditoría real del código** (no de los PRDs) cruzada contra el texto oficial de Meta que el usuario pegó en el chat (página "Revisión de la aplicación" de Messenger + Condiciones de la plataforma + Normas comunitarias + Prácticas recomendadas).

**Veredicto: ❌ NO está listo para enviar a App Review.** El núcleo técnico (webhook firmado, ACK rápido, cifrado de tokens) está bien; faltan piezas **obligatorias de cara al revisor** (política de privacidad + eliminación de datos) y hay un **riesgo de modelo de producto**.

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

## 4. ❌ Lo que FALTA — la guía de verificación de Meta

### 🔴 BLOQUEADORES OBLIGATORIOS (sin esto, rechazo automático)

1. **Política de privacidad pública** — Condiciones de la plataforma, apdo. 4.a. URL accesible (incl. crawlers), sin geobloqueo, publicada en el campo del panel. Debe explicar qué datos se tratan, cómo, con qué fin y **cómo solicitar su eliminación**. → **No existe.** Crear página `/privacy` + link en footer.
2. **Método de eliminación de datos** — apdo. 3.d.i.1 y 4.b ("método claro y de fácil acceso"). → **No existe.** Implementar *Data Deletion Callback* (`/api/meta/data-deletion`, valida `signed_request`, borra datos del tenant, devuelve `{url, confirmation_code}`) **o** página de instrucciones de borrado + opción "eliminar mi cuenta" en la app.
3. **Acceso de prueba para el revisor** — sección "Requisitos". La app está **detrás de login propio** → entregar usuario/contraseña de prueba + frase de activación en las notas del envío.

### 🟠 OBLIGATORIOS / FUERTEMENTE RECOMENDADOS

4. **Forma accesible de reportar vulnerabilidades** — apdo. 6.a.ii. Un email de seguridad en el footer basta. No existe.
5. **Términos de Servicio para los tenants** — como **Proveedor de tecnología** (apdo. 5.b) debes prohibir por contrato usos indebidos a tus clientes. Crear `/terms`.
6. **Ajustes del panel** (acción del usuario, no código): app icon **1024×1024** sin logos de marca, categoría precisa, email de notificaciones en "Todas las notificaciones excepto…", publicar la **página de Facebook** asociada.

### 🟡 RECOMENDADOS (suman puntos, no bloquean)

7. Procesar botón **"Empezar"** + mensaje de bienvenida (hoy se suscribe `messaging_postbacks` pero no se procesa) — `apps/web/lib/meta.ts` suscribe `messages,messaging_postbacks`.
8. **Texto de saludo** (greeting, vía API/panel).
9. Suscribir el evento **`messaging_policy_enforcement`** (avisa de infracciones de política) — añadir a los `subscribed_fields` en `lib/meta.ts`.
10. Manejo del **error 190** (token caduco) con notificación al admin (hoy se persiste el error pero no se notifica).

## 5. ⚠️ RIESGO PRINCIPAL — modelo de producto (leer sí o sí)

La guía de Meta asume una **experiencia interactiva de Messenger** (bot que responde). Resender reenvía a un sistema externo y responde **vía API**. **El revisor enviará un mensaje y esperará respuesta**; si la cuenta de prueba no tiene una automatización conectada respondiendo, verá silencio → **rechazo**.

**Mitigación obligatoria para el envío:** dejar una **automatización de demo** (N8N o similar) conectada que responda automáticamente a cualquier DM, y documentar en las notas: *"envía la palabra X → recibirás respuesta automática"*. El **screencast** debe mostrar: login con Facebook for Business → llega un DM → respuesta automática end-to-end.

## 6. Plan de acción sugerido (orden recomendado)

**Código (lo hace el agente):**
1. Página `/privacy` + footer con links legales y email de seguridad.
2. Eliminación de datos: endpoint `/api/meta/data-deletion` (+ opción en UI).
3. Página `/terms`.
4. (Recomendado) Procesar "Empezar" + saludo + suscribir `messaging_policy_enforcement`.

**Usuario (panel/manual):**
5. Publicar privacy URL en el panel, app icon 1024×1024, categoría, email de notificaciones.
6. Publicar la página de Facebook.
7. Conectar automatización de demo que responda + preparar credenciales/frase de activación para el revisor.
8. Grabar screencast (login → DM entrante → respuesta automática) y escribir el caso de uso de `pages_messaging` (individual, sin copiar-pegar).

> El usuario ya recibió este plan y la última pregunta abierta fue: **"¿implemento los puntos de código (1–4)?"** — esperar su confirmación antes de escribir código.

## 7. Artefactos de referencia (no duplicar — abrir si hace falta)

- `prd_mvp.md` — alcance del MVP de Messenger (ya implementado). App review estaba marcado *Out of Scope* (línea 144).
- `prd_instagram.md` — plan de Instagram (NO implementado). Su sección "Paso 8" describe el App Review de Instagram para referencia futura.
- `CONTEXT.md` — glosario canónico del producto (tenant, ownership, API keys, etc.).
- `README.md` — variables de entorno y comandos de validación (`npm run lint/typecheck/test:run/build`).
- Código clave: `apps/web/app/api/meta/{start,callback,webhook,send}/route.ts`, `apps/web/lib/meta.ts`, `apps/web/lib/crypto/encryption.ts`, `apps/web/lib/pages/page-registry.ts`, `apps/web/db/migrations/0001_mvp_foundation.sql`.

## 8. Notas / gotchas

- developers.facebook.com es una SPA JS → **WebFetch no lee el cuerpo**, solo navegación. Pedir al usuario que pegue el texto, o usar WebSearch.
- Solo existe la migración `0001`. Cualquier cambio de esquema (p. ej. para borrado de datos) requiere `0002` ejecutada con `npm --workspace web run db:migrate`.
- Repo sin tests previos antes del MVP; seguir el patrón de testing que defina `prd_mvp.md`.
- NO hay secretos que redactar en este doc; las credenciales viven en `.env` (no versionado) y nunca se mostraron en el chat.

## 9. Skills sugeridas para la próxima sesión

- **`spec-drafter`** (`/spec-drafter`) — antes de implementar privacy/data-deletion/terms, pasar el plan como spec para obtener mapa del codebase + Gherkin + criterios de aceptación. Invocación manual.
- **`find-docs`** — para la API/forma exacta del **Data Deletion Callback** de Meta y de la *Greeting/Get Started* (Messenger Profile API). No confiar en memoria.
- **`next-best-practices`** — al crear las rutas `/privacy`, `/terms` y el route handler `/api/meta/data-deletion` (convenciones de App Router, route handlers, metadata).
- **`verify`** (`/verify`) o **`run`** (`/run`) — para probar el endpoint de borrado y el flujo end-to-end localmente antes de grabar el screencast.
- **`code-review`** (`/code-review`) — revisar el diff de las piezas nuevas (sobre todo la validación del `signed_request` del callback de borrado) antes de hacer push.
- **`documenter`** — si el usuario quiere registrar la decisión de cumplimiento/compliance como ADR o en el roadmap del proyecto.

