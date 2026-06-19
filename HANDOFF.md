# Handoff — Estrategia de integración Meta para resender

> Documento de traspaso. Resume las **decisiones y hallazgos de investigación** sobre cómo
> integrar Meta (Facebook, Instagram, WhatsApp) en resender y llevarlos a App Review.
> Foco: las dudas resueltas en la última sesión. No duplica los PRDs existentes — los referencia.

## Contexto del proyecto

- **resender** = plataforma SaaS (B2B) que integra distintos servicios a su API para que sus
  clientes gestionen mensajería/reseñas desde un solo lugar.
- Orden de roadmap: **Facebook (en curso) → Instagram → WhatsApp → TikTok → Google Maps**.
- Modelo: resender conecta las cuentas **de sus clientes** (no de resender), es decir, opera
  "en nombre de terceros" → esto dispara requisitos de *Advanced Access*.

### Artefactos existentes (no duplicar — leer estos)
- `fb_requirements.md` — requisitos de Facebook.
- `prd_instagram.md`, `prd_insta_review.md` — PRDs de Instagram.
- `prd_whatsapp.md` — PRD de WhatsApp.
- `prd_google_reviews.md` — PRD de Google Reviews/Maps.
- `docs/` — documentación del proyecto.

## Decisiones y hallazgos clave (sesión actual)

### 1. App Review es incremental — NO hay que sacar FB+IG+WhatsApp juntos
- App Review de Meta es **granular: por permiso/feature**, no la app entera de golpe.
- Meta **rechaza** permisos de features que aún no estén construidas (el revisor sigue tu
  screen recording y prueba la funcionalidad en vivo).
- → Camino correcto = **incremental**: Facebook primero → Instagram → WhatsApp. Un rechazo en
  un canal **no bloquea** los demás.
- Tiempos: ~5–7 días hábiles por submission.

### 2. Business Verification = prerrequisito, arrancar YA en paralelo
- Trámite **único a nivel de Business Portfolio** (no por app). Necesario para *Advanced Access*
  (caso de resender: usuarios sin rol en la app la usan).
- Cómo: Business Manager → Security Center → confirmar datos legales (deben coincidir **exacto**
  con documentos) → subir 2–3 docs (acta constitutiva / licencia / recibo de servicios < 1 año)
  → recibir código de verificación.
- Prerrequisitos que se olvidan: **web propia + correo del dominio** (pilar central), 2FA del
  admin, una app conectada al BM.
- Dificultad: no es difícil, es papeleo. Falla por **inconsistencias** o por **no tener web/dominio**.
- **Acción pendiente:** iniciar Business Verification en paralelo a la Fase 1 (bloquea todo lo demás).

### 3. Instagram — setup A vs B (decisión tomada: **B**)
- Meta permite **un solo setup por app**:
  - **A) Instagram API con Instagram Login** — login directo, sin Página de FB. Para cuentas
    sueltas / Creators sin Página.
  - **B) Instagram API con Facebook Login for Business** — vía Business Manager, multi-cuenta,
    features avanzadas. **Reutiliza el login de Facebook que ya existe.**
- **Decisión: usar B** (es el caso SaaS multi-cliente de resender).
- Se **puede** tener ambos en **dos apps separadas** y Meta **no lo penaliza** en App Review
  (cada app se revisa por sus propios méritos; lo que penaliza son apps vacías/que piden permisos
  que no usan). El costo es **operativo** (doble review/mantenimiento), no de política.
- **Regla:** abrir una 2ª app con setup A **solo si** aparece demanda real de clientes Creator
  sin Página de FB. Decisión **reactiva**, no de entrada.

### 4. WhatsApp — Tech Provider + Embedded Signup (Fase 3, el de más fricción)
- WhatsApp no es "pedir un permiso": Meta clasifica por **rol de socio**.
  - **Tech Provider** = caso de resender (cliente paga a Meta directo, tú cobras tu software).
  - Solution Partner = con línea de crédito/reventa; para players grandes.
- **Embedded Signup** = widget para que el cliente conecte su WhatsApp en pocos clics; genera
  automáticamente su WABA/assets. Necesario para onboarding escalable.
- Orden: **Business Verification → App Review de `whatsapp_business_management` (Advanced) →
  Embedded Signup**.
- Nota: Meta obligó a ISVs a enrolarse como Tech Provider (deadline fue 30-jun-2025).

### 5. Facebook (y Meta en general): SOLO cuentas de negocio, NO perfiles personales
- Messenger Platform API es **exclusiva de Páginas**. **No existe API** para la bandeja de un
  **perfil personal** ni para enviar "como" una persona.
- Restricciones relevantes para resender:
  - Permisos: `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`; Page Access Token.
  - **Ventana de 24h** para responder libre; fuera de eso, message tags aprobados.
    ⚠️ **A partir del 27-abr-2026 varios message tags dejan de funcionar** (error 100) — revisar impacto.
  - El usuario debe **iniciar** la conversación.
  - Conversations API: detalle solo de los **~20 mensajes más recientes** por conversación.
- Igual aplica a Instagram (solo Business/Creator) y WhatsApp (negocio). **Toda la arquitectura
  de resender debe asumir cuentas de negocio/Páginas, nunca perfiles personales.**

## Plan recomendado (orden de ejecución)

```
[Paralelo, AHORA] Business Verification  →  prerrequisito de TODO Advanced Access
                  (requiere: web en dominio + correo corporativo + docs legales)

Fase 1: Facebook    → App Review por permiso (solo lo ya construido + screencasts)
Fase 2: Instagram   → setup B (Facebook Login for Business), una sola app → App Review
Fase 3: WhatsApp    → Tech Provider + App Review (Advanced) + Embedded Signup
Fase 4+: TikTok, Google Maps
```

## Próximos pasos sugeridos (pendientes)
1. **Iniciar Business Verification** (reunir web/dominio/correo corporativo + documentos legales).
2. Revisar el **código actual de Facebook** para definir **qué permisos exactos** mandar en Fase 1
   (solo los que ya tienen funcionalidad + screencast).
3. Confirmar qué **mensajería de Instagram (DMs)** soporta el setup B antes de comprometerse
   (resender va de mensajes) — quedó como duda abierta.
4. Evaluar impacto del cambio de **message tags del 27-abr-2026** en el flujo de Facebook.
5. Alinear los PRDs (`prd_instagram.md`, `prd_whatsapp.md`, etc.) con estas decisiones.

## Suggested skills
- **`documenter`** — registrar estas decisiones como ADRs y actualizar la documentación del
  proyecto (roadmap/flows/decisiones) en el sistema estándar.
- **`find-docs` / `ctx7`** — para consultar docs vivas de las APIs de Meta (Messenger, Instagram
  Graph, WhatsApp Business Platform) al implementar.
- **`spec-writer`** — convertir los PRDs + estas decisiones en SPECs/issues de trabajo.
- **`grill-with-docs`** — si se quiere estresar el plan de integración contra el modelo de
  dominio/decisiones documentadas antes de codear.

## Fuentes (referencia)
- App Review: https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review
- Instagram (FB Login for Business): https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram/
- Instagram (Instagram Login): https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/
- WhatsApp Tech Provider: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Messenger Send API: https://developers.facebook.com/docs/messenger-platform/reference/send-api/
- Messenger Conversations API: https://developers.facebook.com/docs/messenger-platform/conversations/
- Meta Business Verification (guía): https://docs.360dialog.com/docs/resources/meta-business-verification
