# PRD — App Review de Meta para el canal de Instagram (Advanced Access)

> Extiende el MVP (`prd_mvp.md`) y el canal de Instagram (`prd_instagram.md`), y sigue la convención de `prd_google_reviews.md`. **No agrega un canal nuevo**: define el **expediente de cumplimiento** y los **cambios de producto** necesarios para que la app pase la **App Review de Meta** y obtenga **Advanced Access** de `instagram_business_manage_messages`, de modo que Resender pueda procesar DMs de cuentas de Instagram **de terceros** (multi-tenant) y no solo de cuentas propias en modo desarrollo. Clasifica cada requisito de Meta en **obligatorio / opcional / ignorable** según el fit con el producto.

## Problem Statement

El canal de Instagram (`prd_instagram.md`) habilita técnicamente recibir y responder DMs, pero con **Standard Access** solo funciona con **cuentas propias de prueba** en modo desarrollo. La razón de ser de Resender es servir cuentas de **terceros** (es multi-tenant: `tenantId`, ownership exclusivo por tenant). Para procesar mensajes en nombre de otros negocios, Meta exige **Advanced Access** de `instagram_business_manage_messages`, que **solo** se obtiene pasando **App Review** + **Business Verification**.

Hoy falta todo el expediente de App Review (screencast, instrucciones, plataforma, credenciales de prueba), faltan artefactos legales y de cuenta obligatorios (política de privacidad pública, mecanismo de eliminación de datos, ToS para tenants, página de soporte, canal de reporte de vulnerabilidades), y existen **dos comportamientos de producto que chocan o no cubren** las políticas de Meta:

1. **Retención vs borrado**: el producto "conserva el historial como bitácora" al desconectar (`CONTEXT.md:48`) y declara el borrado duro como _Out of Scope_ (`prd_mvp.md:143`), pero _Platform Terms §3.d_ obliga a eliminar Platform Data cuando el usuario lo solicita o ya no tiene cuenta, y _§4_ exige un método de eliminación accesible a **todos** los usuarios.
2. **Mensajes anulados (unsent)**: el screencast de App Review exige demostrar el manejo de mensajes anulados, pero el parser de Instagram solo contempla `messages` de texto (`prd_instagram.md:72,125`).

Sin resolver esto, la app no puede salir de modo desarrollo ni dar de alta clientes reales.

## Solution

Construir el **expediente de App Review** y los **cambios mínimos de producto** para aprobar, posicionando a Resender ante los revisores como una **experiencia automatizada** (un _gateway_ que alimenta la automatización del tenant en N8N/IA), **no** como una bandeja de entrada manual — coherente con que la UI `Messages` es solo bitácora y que componer respuestas está _Out of Scope_ (`prd_mvp.md:135`).

El trabajo se divide en tres frentes:

- **Código nuevo en Resender** (lo mínimo que App Review obliga y el PRD de Instagram no cubre): endpoint de **Data Deletion Request Callback** + lógica de **borrado bajo solicitud**; manejo del **evento `unsend`** (soft-delete en bitácora + reenvío al `webhookUrl`); una **página de privacidad** pública servida por la app.
- **Artefactos no-código**: **Business Verification** del negocio, **página de Facebook de soporte** con datos de contacto, **ToS de Proveedor de Tecnología** que los tenants aceptan, **email de seguridad** para reporte de vulnerabilidades.
- **Preparación del review**: una **automatización demo** (N8N) + una **cuenta de prueba** de Resender para grabar el **screencast** end-to-end, y el llenado del formulario de App Review.

Se mantiene **Standard Access (cuentas propias)** como **fase previa** para validar el flujo real sin review (igual que `prd_instagram.md:177-179, 193-197`).

## Decisión de estrategia (posicionamiento y alcance)

Estas seis decisiones fijan todo el expediente. Análogas a la "Decisión de arquitectura" de los otros PRD.

- **Alcance = Apps for other businesses / Advanced Access.** El review apunta a servir cuentas de terceros. Esto dispara screencast, Business Verification y Advanced Access. (La fase previa de cuentas propias usa Standard Access y **no** requiere review.)
- **Variante = Instagram API con Instagram Login.** Permisos `instagram_business_basic` + `instagram_business_manage_messages`. **NO** la variante "Messenger API compatibility / Facebook Login" — aunque la doc oficial que circula describe esa otra variante (`instagram_basic`, `instagram_manage_messages`, `pages_*`, `business_management`). Es el error de interpretación #1 (ver _Riesgos_).
- **Posicionamiento = experiencia automatizada.** El bot vive en el sistema externo del tenant y responde <30s; Resender es el gateway. No se construye inbox de respuesta manual.
- **Borrado = Data Deletion Callback + borrado bajo solicitud.** La bitácora se conserva **solo mientras la relación esté activa** (fin empresarial legítimo). Se borra de verdad cuando el tenant elimina su cuenta, el tenant lo pide, o el usuario final lo solicita vía el callback de Meta.
- **Demo = automatización N8N externa + cuenta de prueba.** No se construye nada nuevo en Resender para el screencast; se prepara infra de demo y credenciales para los revisores.
- **Consentimiento/opt-out = contractual (ToS del tenant) + opt-out nativo de Instagram.** Como Resender solo responde reactivamente dentro de 24h y no controla el contenido (lo genera el tenant), el cumplimiento recae en el tenant por contrato; el opt-out se apoya en el bloqueo/silencio nativo de IG.
- **Mensajes anulados = soft-delete + reenviar evento.** Se marca el mensaje como "eliminado por el usuario" (se conserva metadata, se oculta el contenido) y se reenvía el evento de unsend al `webhookUrl`.

## Requisitos clasificados (obligatorio / opcional / ignorable)

Leyenda: ✅ Obligatorio (sí o sí para aprobar) · 🟡 Opcional (hace fit, no bloquea) · ⛔ Ignorable (no aplica a Resender).

### 1. Permisos

| Permiso | Estado | Nota |
|---|---|---|
| `instagram_business_basic` | ✅ | Identidad/metadata de la cuenta IG. Variante elegida. |
| `instagram_business_manage_messages` | ✅ | **Permiso central.** Advanced Access → screencast + Business Verification. |
| `instagram_basic`, `instagram_manage_messages` | ⛔ | De la variante **Facebook Login**. No se usan. |
| `pages_messaging`, `pages_show_list`, `business_management` | ⛔ | Dependencias de la variante Facebook Login. El camino IG Login **no usa Páginas de FB**. |
| Función **Human Agent** (responder hasta 7 días) | 🟡 | _Out of Scope_ (`prd_instagram.md:122`). Solo si luego se ofrece inbox humano con SLA largo. |

### 2. Expediente del envío (App Verification Details)

| Requisito | Estado | Nota |
|---|---|---|
| **Screencast** del flujo completo | ✅ | Login en Resender → conectar IG por **Business Login for Instagram** → configurar `webhookUrl` (= "experiencia automatizada") → DM entrante → respuesta auto **<30s** → manejo de **unsent**. La app grabada debe ser **idéntica** a la enviada. |
| **Platform = Website** + URL de login | ✅ | URL pública donde el tenant inicia sesión y configura. |
| **Instrucciones paso a paso** | ✅ | Cómo loguearse, autorizar permisos y configurar la automatización. |
| **Credenciales de cuenta de prueba** | ✅ | Se elige _"No uso Facebook Login para entrar a mi sitio"_ (Resender usa email/password) → se entrega **usuario/clave de prueba** a los revisores. |
| **Descripción por permiso** | ✅ | Por permiso: qué dato usa y cómo. |
| Demostrar **custom inbox** (leer/responder/eliminar en la app) | ⛔ | No aplica (experiencia automatizada). En su lugar se muestra cómo **escala a un agente humano** vía el sistema externo. |

### 3. Cuenta y negocio

| Requisito | Estado | Nota |
|---|---|---|
| **Business Verification** (Meta Business Settings) | ✅ | Requisito de Advanced Access. Documentos legales del negocio. **Empezar ya: tarda.** |
| **Página de Facebook de soporte** con contacto | ✅ | _Developer Policies §5_: dirección postal + (email/web/teléfono). Aplica aunque el canal sea IG. |
| Cuenta IG **profesional** (Business/Creator) de prueba | ✅ | Las personales no pueden mensajería (`prd_instagram.md:131`). |
| App de tipo **Business** en el panel | ✅ | Implícito en el setup actual. |

### 4. Cumplimiento de datos

| Requisito | Estado | Nota |
|---|---|---|
| **Política de privacidad** pública (URL en App Dashboard, sin geobloqueo, accesible a crawlers) | ✅ | _Platform Terms §4_. **No existe hoy** → crear. |
| **Data Deletion** (Callback URL o instrucciones) | ✅ | Decisión de estrategia → **callback**. _Platform Terms §3.d_. |
| **Borrado bajo solicitud** (tenant se va / lo pide / usuario final lo pide) | ✅ | Reconcilia con la bitácora. |
| **Cifrado de tokens at-rest** | ✅ (hecho) | `lib/crypto/encryption.ts`. ✔️ |
| **Verificación de firma del webhook** (`X-Hub-Signature-256` con `INSTAGRAM_APP_SECRET`) | ✅ (planeado) | `prd_instagram.md:70`. Réplica del de Messenger. |
| **Canal para reportar vulnerabilidades** | ✅ | _Platform Terms §6.a.ii_. Basta un email de seguridad publicado. |
| No solicitar/almacenar credenciales de login de Meta de los usuarios | ✅ (hecho) | Se usa OAuth → ya cumple. |

### 5. Comportamiento de mensajería

| Requisito | Estado | Nota |
|---|---|---|
| **Ventana de 24h** (rechazar fuera de ventana) | ✅ | `prd_instagram.md:83-84`. Validar en código. |
| **Respuesta <30s** del bot automatizado | ✅ (para el demo) | En producción depende del tenant → cubierto por ToS. La **automatización demo** debe responder <30s. |
| **Consentimiento** del usuario | ✅ | Reactivo dentro de 24h = consentimiento implícito + ToS del tenant. |
| **Opt-out** | ✅ | Bloqueo/silencio nativo de IG + ToS. |
| **Manejo de mensajes anulados (unsent)** | ✅ | Soft-delete + reenviar. Requiere ampliar el parser (hoy solo texto). |
| **Aviso de bot** ("hablas con un bot") | 🟡 | Obligatorio solo para usuarios de **California/Alemania**; recomendado siempre. Responsabilidad del tenant (genera el contenido) vía ToS. |
| **Notificación única / respuestas privadas / news messages** | ⛔ | No disponibles en IG Messaging API o fuera del modelo. |
| **Marketing/ads messages** fuera de 24h | ⛔ | No se usan; el MVP solo responde dentro de ventana. |

### 6. Rol de Proveedor de Tecnología (Tech Provider)

Servir cuentas de terceros convierte a Resender en **Tech Provider** (_Platform Terms §5.b_), lo que activa:

| Requisito | Estado | Nota |
|---|---|---|
| **ToS para tenants** que les obliguen a cumplir las políticas de Meta (Meta ToS, Developer Policies, IG Terms, Community Standards) | ✅ | **No existen hoy** → redactar. |
| **Separación de datos por cliente** | ✅ (hecho) | Multi-tenant (`tenantId`) + ownership exclusivo. ✔️ |
| **Lista actualizada de clientes** disponible para Meta | ✅ (derivable) | Desde la base de datos. |
| Cortar acceso de un cliente si Meta lo pide | ✅ | Cubierto por la acción de desconectar/desactivar. |

### 7. Lo que se IGNORA (no aplica a Resender)

⛔ Juegos · Live API · Anuncios/Audience Network · Marketplace · Commerce · Plugins sociales · Pagos/Meta Payments · Experiencias instantáneas · Mensajes de noticias (NPI) · Llamadas VoIP/PSTN · Variante completa Facebook Login (`pages_*`, `business_management`) · Media en mensajes (imágenes/audio/video — _Out of Scope_, `prd_instagram.md:121`) · Comentarios/menciones en stories/postbacks/quick replies (`prd_instagram.md:125`).

## User Stories

1. As a product owner, I want Resender to obtain Advanced Access for `instagram_business_manage_messages`, so that I can onboard third-party Instagram accounts instead of only my own test accounts.
2. As a product owner, I want to complete Business Verification early, so that the slowest gating step does not block submission later.
3. As a product owner, I want Resender positioned to Meta reviewers as an automated experience (gateway + external automation), so that I do not have to build a manual inbox that is out of scope.
4. As a reviewer (Meta), I want a screencast that shows login, Instagram Business Login consent, configuring the automation, an inbound DM auto-answered in under 30 seconds, and unsent handling, so that I can validate the use case end to end.
5. As a reviewer (Meta), I want test-account credentials for Resender, so that I can access the product without a Facebook role.
6. As an end user (Instagram), I want a clear, public way to request deletion of my data, so that I can exercise my rights under Meta Platform Terms.
7. As a tenant, I want a way to delete my data when I leave, so that Resender stops retaining my Platform Data after the relationship ends.
8. As an end user, I want a message I unsend to be reflected downstream, so that my deletion intent propagates to the tenant's automation.
9. As a tenant, I want to accept Terms of Service that bind me to Meta's policies, so that Resender can lawfully operate as my technology provider.
10. As a security researcher, I want an accessible channel to report vulnerabilities, so that issues in Resender can be fixed promptly.
11. As a developer, I want the App Review compliance work scoped as scaffolding over the existing deep modules, so that route handlers stay thin and the Instagram channel code is reused.
12. As a product owner, I want to keep operating in Standard Access with my own accounts first, so that I validate the real flow before submitting for review.

## Implementation Decisions

### Data Deletion (código nuevo)
- Ruta nueva `apps/web/app/api/meta/data-deletion/route.ts` (compartida Messenger/Instagram) que implementa el **Data Deletion Request Callback** de Meta: recibe el `signed_request` firmado con el App Secret correspondiente, lo verifica, resuelve el sujeto (usuario final por IGSID/PSID, o cuenta) y dispara el borrado, devolviendo `{ url, confirmation_code }` como exige Meta.
- Lógica de **borrado bajo solicitud** en un deep module nuevo `apps/web/lib/compliance/data-deletion.ts`:
  - **Tenant elimina cuenta / lo solicita** → borra sus `connected_pages`, tokens, `conversations`, `messages` (y `google_reviews` si aplica) del tenant.
  - **Usuario final lo solicita (callback)** → borra/anonimiza los `messages` y la `conversation` asociados a ese IGSID/PSID en las cuentas afectadas.
- **Reconciliación con la bitácora**: el default sigue siendo conservar al **desconectar** (relación activa). El borrado real se dispara solo en los casos de _Platform Terms §3.d_. Esto **enmienda** `CONTEXT.md:48` y el _Out of Scope_ `prd_mvp.md:143` (ver ADR sugerido).
- **Confirmación de borrado**: registrar prueba de eliminación (timestamp + alcance) para poder acreditarla si Meta la pide (_§3.d.iii_, _§7_).

### Manejo de mensajes anulados (unsent) (código nuevo)
- Ampliar `apps/web/lib/inbound/meta-webhook.ts` (rama `object:"instagram"`) para reconocer el evento de **unsend** (mensaje borrado por el usuario) además de `messages` de texto.
- En la ingestión (`inbound-ingestion.ts`): localizar el `message` por `mid`, marcarlo como **soft-deleted** (nuevo estado/flag; se conserva metadata, se oculta el contenido en la bitácora) y **reenviar el evento** al `webhookUrl` con un `type:"message_unsent"` para que la automatización del tenant reaccione.
- UI `Messages`: render del mensaje anulado con indicador "eliminado por el usuario" (sin mostrar el texto original).

### Página de privacidad (código/contenido nuevo)
- Servir una **política de privacidad pública** (p. ej. `apps/web/app/(public)/privacy/page.tsx` o equivalente estático), sin geobloqueo y accesible a crawlers, y publicar su URL en el campo "Privacy Policy" del App Dashboard.
- Debe describir qué Platform Data se trata (IGSID, `mid`, contenido del DM, metadata de cuenta), con qué fin (gateway + bitácora + reenvío a la automatización del tenant), y **cómo solicitar la eliminación** (apuntando al mecanismo de Data Deletion).

### Expediente del envío (no-código)
- Configurar **Platform = Website** con la URL de login de Resender.
- Redactar **instrucciones paso a paso** (plantilla de Meta) cubriendo login, autorización de permisos vía Instagram Business Login, y configuración de la automatización.
- Crear una **cuenta de prueba** de Resender (email/password) con una cuenta IG profesional de prueba ya conectada, y entregar credenciales a los revisores.
- Escribir la **descripción por permiso** (`instagram_business_basic`, `instagram_business_manage_messages`).

### Artefactos de negocio (no-código)
- Completar **Business Verification** en Meta Business Settings.
- Crear/activar una **página de Facebook de soporte** con dirección postal + email/web/teléfono.
- Publicar un **email de seguridad** (p. ej. `security@…`) como canal de reporte de vulnerabilidades.

### ToS de Proveedor de Tecnología (no-código)
- Redactar y exponer **Términos de Servicio** que los tenants aceptan, obligándolos a: obtener consentimiento, dar aviso de bot cuando la ley aplique (CA/Alemania), honrar opt-outs, y cumplir Meta ToS / Developer Policies / Instagram Terms / Community Standards.
- Documentar internamente la **lista de clientes** (derivable de `tenants`) por si Meta la solicita.

### Demo del screencast (no-código)
- Montar una **automatización N8N** de demostración conectada al `webhookUrl` de la cuenta de prueba, que responda por `POST /api/instagram/send` (o `/api/meta/send` con `channel:"instagram"`) en **<30s**.
- Guion del screencast que muestre: login, conexión IG, configuración del `webhookUrl`, DM entrante, respuesta automática <30s, y un mensaje anulado reflejado en la bitácora.

### Principios
- El trabajo de cumplimiento se construye como **andamiaje delgado** sobre los deep modules existentes; los route handlers quedan finos (igual que MVP/Instagram/Google).
- No se rompen Messenger ni Instagram: el Data Deletion Callback y el unsend se ramifican por `channel`/`object`, y la bitácora sigue siendo la fuente durable.

## Testing Decisions

- **Data Deletion Callback** (`lib/compliance/data-deletion.ts` + ruta): `signed_request` válido (firma correcta) procesa el borrado y devuelve `{ url, confirmation_code }`; firma inválida → `400/401`; borrado de tenant elimina sus `connected_pages`/tokens/`conversations`/`messages`; borrado de usuario final anonimiza/elimina solo los mensajes de ese IGSID; idempotencia (segunda solicitud no falla); registro de prueba de eliminación.
- **Reconciliación bitácora**: desconectar (relación activa) **conserva** el historial; solicitud de borrado **sí** elimina. Ambos casos cubiertos por test.
- **Unsent**: el parser reconoce el evento de unsend y lo distingue de un `messages` de texto; la ingestión marca soft-delete por `mid` y arma el reenvío `type:"message_unsent"`; un `mid` inexistente no rompe el ack; el push externo fallido no revierte el soft-delete.
- **Página de privacidad**: responde `200` sin auth, sin geobloqueo, accesible a un user-agent de crawler.
- **Regresión**: el flujo de Instagram (`prd_instagram.md`) y Messenger siguen pasando; el Data Deletion no afecta envíos/recepciones normales.
- Un test de integración por ruta nueva (`/api/meta/data-deletion`) que verifique cableado y códigos de estado.

## Out of Scope (esta fase)

- **Función Human Agent** (responder fuera de 24h hasta 7 días) y la UI de inbox manual (custom inbox). El review se posiciona como experiencia automatizada.
- **Features de mensajería para opt-out** en Resender (palabras clave STOP, lista de supresión por IGSID, inyección de aviso de bot). Se cubre por ToS + opt-out nativo de IG. Solo se reconsidera si se habilitan mensajes proactivos fuera de 24h.
- **Mensajes proactivos / marketing / message tags** fuera de la ventana de 24h.
- **Media** en mensajes (imágenes/audio/video), comentarios, menciones de stories, postbacks/quick replies — heredado de `prd_instagram.md:121,125`.
- **Rate limiting propio** para el límite de 200 DMs/hora (`prd_instagram.md:123`).
- **Hard delete total automático al desconectar** (se conserva la bitácora mientras la relación esté activa; el borrado duro es solo bajo solicitud / fin de relación).
- Automatización de envío del formulario de App Review (es manual en el panel de Meta).

## Further Notes / Riesgos

- **Discrepancia de variante (riesgo de interpretación #1):** la doc oficial de "App Review para compatibilidad de **Messenger API** con apps de Instagram" describe la variante **Facebook Login** (`instagram_basic`, `instagram_manage_messages`, `pages_*`, `business_management`, conectar Página de FB). El producto usa **Instagram Login** (`instagram_business_basic`, `instagram_business_manage_messages`, sin Páginas). Tomar la lista de permisos de la doc equivocada hace que el envío se rechace. La fuente de verdad de permisos es **este PRD + `prd_instagram.md`**.
- **Business Verification es el gate lento:** puede tardar días/semanas y bloquea Advanced Access. Iniciarla **antes** de tener el screencast listo.
- **La app en vivo debe ser idéntica al screencast:** si difiere, Meta rechaza. Congelar el flujo entre grabación y envío.
- **El `<30s` depende del tenant en producción:** Resender no genera respuestas. La política de capacidad de respuesta (experiencia automatizada) es responsabilidad del tenant (cubierta por ToS); el riesgo de feedback negativo / restricción de mensajería existe si los tenants automatizan mal. Monitorear la tasa de bloqueos.
- **Inactividad 28 días (_Platform Terms §7.e.iii_):** una app que no usa sus permisos durante 28 días puede perder acceso. Mantener tráfico real o de prueba tras la aprobación.
- **Retención vs borrado contradice la doc actual:** `CONTEXT.md:48` ("conserva el historial") y `prd_mvp.md:143` ("hard deletion _out of scope_") quedan **enmendados** por la decisión de borrado bajo solicitud. Actualizar `CONTEXT.md` y registrar el ADR para que un lector futuro entienda el porqué.
- **Expiración de token IG (~60 días):** sin el cron de refresh (`prd_instagram.md:87-88,134`) las conexiones se caen; aunque no es un requisito de App Review, una conexión caída rompe el demo y la operación.
- **Doble secreto de firma:** el Data Deletion Callback y el webhook de Instagram se verifican con el **Instagram App Secret**, distinto del `META_APP_SECRET` (`prd_instagram.md:130`). Es el error de configuración más probable.

---

# Guía de configuración en el panel de Meta + artefactos (lo que haces tú)

Esta es la parte manual. El código de arriba asume que estos pasos quedaron hechos. Hay cuatro bloques: **(A) Business Verification**, **(B) artefactos de cumplimiento**, **(C) preparar el screencast**, **(D) envío de App Review**.

## Bloque A — Business Verification (one-time, puede tardar)

> Sin esto no hay Advanced Access. **Empieza por aquí.**

1. En **Meta Business Settings** → **Security Center / Business Verification**, inicia la verificación del negocio.
2. Ten a mano documentos legales (registro mercantil, comprobante de dirección, etc.) y un dominio/sitio web del negocio.
3. Espera la aprobación (puede tardar). Avanza en paralelo con los bloques B y C.

## Bloque B — Artefactos de cumplimiento

1. **Política de privacidad**: publica la página pública (servida por la app o externa) y pon su URL en **App Dashboard → Settings → Basic → Privacy Policy URL**.
2. **Data Deletion**: en **App Dashboard → Settings → Basic → Data Deletion**, configura la **Callback URL** `https://<TU_APP_URL>/api/meta/data-deletion` (o, como mínimo, una URL de instrucciones). Verifica que el endpoint responde el `{ url, confirmation_code }` esperado.
3. **Página de Facebook de soporte**: créala/actívala con dirección postal + email/web/teléfono de soporte (_Developer Policies §5_).
4. **Email de seguridad**: publica un canal accesible para reportar vulnerabilidades (_Platform Terms §6.a.ii_).
5. **ToS de tenant**: publica los Términos de Servicio y enlázalos en el onboarding de Resender.

## Bloque C — Preparar el screencast (variante Instagram Login)

1. Configura **Platform = Website** en el panel con la URL de login de Resender.
2. Crea una **cuenta de prueba** de Resender (email/password) y conéctale una **cuenta IG profesional de prueba** (Business/Creator).
3. Monta la **automatización N8N demo** apuntando al `webhookUrl` de esa cuenta, que responda por la API de Resender en **<30s**.
4. Graba mostrando: (a) login en Resender; (b) **Continuar con Instagram** / Business Login for Instagram y concesión de permisos; (c) configuración del `webhookUrl` (la "experiencia automatizada"); (d) un DM entrante respondido automáticamente en <30s; (e) un mensaje **anulado** reflejado como "eliminado por el usuario" en la bitácora; (f) cómo se **escala a un agente humano** vía el sistema externo (en lugar de custom inbox).
5. Asegúrate de que la app grabada es **idéntica** a la que enviarás.

## Bloque D — Envío de App Review

1. **App Dashboard → App Review → Permissions and Features** → solicita `instagram_business_basic` e `instagram_business_manage_messages` (Advanced Access).
2. Sigue la guía **"Apps for other businesses"** (no la de "your business").
3. Por cada permiso: sube el **screencast**, escribe la **descripción** (qué dato usa y cómo) e incluye las **instrucciones paso a paso**.
4. En **Credenciales**, elige _"No uso Facebook Login para entrar a mi sitio"_ y entrega usuario/clave de la **cuenta de prueba** (no des datos personales ni de cuentas reales de terceros).
5. Envía y monitorea el **buzón de ayuda de la página** de la app por si Meta pide aclaraciones.

## Checklist de validación / aprobación

1. Business Verification **aprobada**.
2. Privacy Policy URL y Data Deletion Callback **configurados y respondiendo** correctamente.
3. Página de FB de soporte **activa** con datos de contacto; email de seguridad publicado; ToS de tenant en línea.
4. Cuenta de prueba + cuenta IG profesional + automatización N8N **funcionando end-to-end** (<30s).
5. Screencast grabado mostrando login, consentimiento IG, configuración, respuesta automática y unsent; app **idéntica** a la enviada.
6. Solicitud de `instagram_business_basic` + `instagram_business_manage_messages` enviada con descripciones e instrucciones.
7. Tras aprobación: mantener tráfico para no caer en la inactividad de 28 días y el cron de refresh de tokens IG activo.
