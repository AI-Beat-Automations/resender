# Handoff — Resender: Auditoria actualizada para Meta App Review (Messenger)

> **Proposito:** Dejar un estado confiable para preparar **Resender** para **Meta App Review** del permiso `pages_messaging`.
> **Analisis original:** 2026-06-17 · **Actualizacion:** 2026-06-20 · **Repo:** `/Users/arturo/git/resender` · **Branch:** `main`
> **Idioma de trabajo del usuario:** Espanol.

---

## 1. Contexto en una frase
Resender es un **gateway + bitacora** para Facebook Messenger: recibe webhooks de Meta, persiste conversaciones/mensajes, los reenvia al `webhookUrl` externo del tenant (N8N/IA) y permite responder via API con una API key opaca. **No es un bot conversacional con UI propia**; las respuestas llegan desde el sistema externo del cliente. Esto sigue siendo el mayor riesgo practico para App Review.

## 2. Veredicto actualizado
**Estado: aun no listo para enviar a App Review.**

El nucleo tecnico esta sano y varias piezas que antes faltaban ya fueron implementadas. La app compila y la suite local pasa. Lo que queda no es tanto "el webhook no funciona", sino preparacion de revision: demo end-to-end, configuracion del panel Meta, terminos legales, y algunos riesgos de comportamiento silencioso.

Validacion local ejecutada el 2026-06-20:

```bash
npm run test:run
npm run typecheck
npm run lint
npm run build
```

Resultado: todo verde.

## 3. Lo que YA esta implementado
| Requisito / pieza                                                 |         Estado actual | Evidencia                                                                                                 |
| ----------------------------------------------------------------- | --------------------: | --------------------------------------------------------------------------------------------------------- |
| Webhook Meta responde rapido y valida firma `X-Hub-Signature-256` |              ✅ Hecho | `apps/web/app/api/meta/webhook/route.ts`                                                                  |
| Verificacion del challenge `hub.challenge`                        |              ✅ Hecho | `apps/web/app/api/meta/webhook/route.ts`                                                                  |
| OAuth con Facebook Login for Business por `config_id`             |              ✅ Hecho | `apps/web/lib/meta.ts`, `apps/web/app/api/meta/start/route.ts`, `apps/web/app/api/meta/callback/route.ts` |
| Suscripcion all-or-nothing de Pages al webhook de Meta            |              ✅ Hecho | `apps/web/lib/meta.ts`, `apps/web/app/api/meta/callback/route.ts`, `apps/web/lib/pages/page-registry.ts`  |
| Tokens de Page cifrados en reposo                                 |              ✅ Hecho | `apps/web/lib/crypto/encryption.ts`, `apps/web/lib/pages/page-registry.ts`                                |
| API externa de salida con API key opaca                           |              ✅ Hecho | `apps/web/app/api/meta/send/route.ts`, `apps/web/lib/api-keys/*`                                          |
| Separacion por tenant                                             |              ✅ Hecho | `tenant_id` en migracion `0001_mvp_foundation.sql`                                                        |
| Politica de privacidad publica                                    |              ✅ Hecho | `apps/web/app/privacy/page.tsx`                                                                           |
| Instrucciones publicas de eliminacion de datos                    |              ✅ Hecho | `apps/web/app/data-deletion/page.tsx`                                                                     |
| Borrado self-serve de cuenta                                      |              ✅ Hecho | `apps/web/features/account/ui/delete-account-panel.tsx`, `apps/web/features/account/actions.ts`           |
| Borrado cascada de tenant/datos                                   |              ✅ Hecho | `apps/web/db/migrations/0002_account_deletion_cascade.sql`                                                |
| Desuscripcion best-effort al borrar cuenta                        |              ✅ Hecho | `apps/web/features/account/actions.ts`, `apps/web/lib/meta.ts`                                            |
| Contacto para privacidad/seguridad                                | ✅ Hecho, pero basico | `info@resender.dev` en `/privacy` y footer                                                                |

## 4. Cambio importante respecto al handoff anterior
El handoff anterior decia que **no existian** `/privacy`, metodo de eliminacion de datos ni borrado de cuenta. Eso ya cambio.

Decision documentada en `CONTEXT.md`: Resender **no usa Data Deletion Callback** de Meta porque el `signed_request` trae un Facebook `user_id` que hoy no se guarda ni mapea al tenant. En su lugar, el panel de Meta debe apuntar a una **Data Deletion Instructions URL** publica: `/data-deletion`. El borrado real ocurre por:

1. Boton self-serve en `Settings`.
2. Solicitud por email a `info@resender.dev` en menos de 30 dias.

Si Meta exigiera explicitamente callback para esta app, habria que cambiar arquitectura: guardar el FB user id del autorizante durante OAuth y mapearlo a tenant, o crear un callback que responda instrucciones/confirmacion sin borrar automaticamente.

## 5. Brechas actuales priorizadas
| Prioridad | Falta / riesgo                                                                                                                                                                                                                                                                                                                                | Evidencia en codigo                                                                                                                                                                   | Accion recomendada                                                                                                                                                                                                         | ¿Se puede omitir?                           |
| --------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
|      🔴 1 | **Cuenta de revision + demo automatizada / screencast pendiente**. El revisor no debe hacer onboarding desde cero; debe recibir una cuenta Resender preconfigurada con Page conectada, `webhookUrl` y automatizacion activa. Usuario Messenger de prueba confirmado como tester y relacionado en Resender para grabar el video antes de Live. | Si `webhookUrl` es `null`, se registra delivery `skipped` en `apps/web/lib/inbound/inbound-ingestion.ts`; Meta exige demostrar que `pages_messaging` envia mensajes a Messenger.      | Pendiente operativo: grabar el screencast con la Page de revision y la automatizacion demo respondiendo por `/api/meta/send`. En notas, explicar que la cuenta esta preconfigurada y que no deben conectar una Page nueva. | No                                          |
|      ✅ 2 | **Notas, credenciales y screencast para App Review** preparadas. La app esta detras de login propio. Usuario de revision: `demo@resender.dev`; password final definido fuera del repo; screencast disponible en YouTube; Page demo definida.                                                                                                  | Flujo protegido por `auth()` en layout de producto.                                                                                                                                   | Pegar notas finales en Meta App Review. No guardar passwords en archivos versionados y rotar el password al terminar la revision.                                                                                          | No                                          |
|      ✅ 3 | **Configuracion del panel Meta (Basic + Login config)** completada. Alcance decidido y corregido: solo Messenger. Dominio canonico: `resender.dev`; URLs legales publicas guardadas; categoria seleccionada: Bots de Messenger para empresas; email real: `info@resender.dev`; App Icon cargado; Page asociada/publicada desde AI Beat.       | Permisos viven en `NEXT_PUBLIC_META_CONFIG_ID`, no en codigo; el `config_id` quedo con `pages_manage_metadata`, `pages_messaging`, `pages_show_list`.                                 | Mantener el `config_id` sin permisos extra y no cambiar las URLs `https://resender.dev/privacy` + `https://resender.dev/data-deletion`.                                                                                    | No                                          |
|      ✅ 4 | **La suscripcion al webhook ya no falla silenciosamente**. El onboarding de Pages es all-or-nothing: Resender valida configuracion local y ownership, exige que Meta confirme `subscribed_apps` para todas las paginas devueltas y solo despues las guarda como activas.                                                                        | `apps/web/app/api/meta/callback/route.ts`, `apps/web/lib/meta.ts`, `apps/web/lib/crypto/encryption.ts`, `apps/web/lib/pages/page-registry.ts`, `apps/web/app/(product)/connections/page.tsx`, `apps/web/lib/meta.test.ts`. | Mantener este comportamiento: si falla una suscripcion, mostrar error y no persistir ninguna Page.                                                                                                                         | Hecho                                       |
|      ✅ 5 | **Terms of Service para tenants**.                                                                                                                                                                                                                                                                                                            | `apps/web/app/terms/page.tsx`; footer publico enlaza Terms.                                                                                                                           | Mantener `/terms` publicado y alineado con politicas de Meta, uso aceptable, responsabilidades del tenant y contacto legal.                                                                                                | Hecho                                       |
|      🟠 6 | **`webhookUrl` externo acepta `http://`** aunque transporta mensajes de Messenger.                                                                                                                                                                                                                                                            | `apps/web/lib/pages/webhook-url.ts` permite `http` y `https`.                                                                                                                         | Exigir HTTPS en produccion; permitir HTTP solo para localhost/dev si hace falta.                                                                                                                                           | Riesgoso omitir                             |
|      🟠 7 | **Desconectar Page no desuscribe de Meta**. La Page queda localmente `disconnected`, pero Meta puede seguir llamando al webhook del app.                                                                                                                                                                                                      | `disconnectPageAction()` solo llama `disconnectPage()`.                                                                                                                               | Al desconectar, cargar token y llamar `unsubscribeFromWebhook()` best-effort.                                                                                                                                              | Puede omitirse para review, no para higiene |
|      🟡 8 | **No se suscribe `messaging_policy_enforcement`**.                                                                                                                                                                                                                                                                                            | `subscribed_fields: "messages,messaging_postbacks"` en `apps/web/lib/meta.ts`.                                                                                                        | Agregar `messaging_policy_enforcement` para enterarse de infracciones/avisos.                                                                                                                                              | Si, pero conviene                           |
|      🟡 9 | **Se suscribe `messaging_postbacks`, pero no se procesan postbacks/Get Started**.                                                                                                                                                                                                                                                             | `extractInboundTextMessages()` solo procesa `message.text`.                                                                                                                           | Procesar al menos `postback.payload === "GET_STARTED"` o no depender de Get Started en la demo.                                                                                                                            | Si                                          |
|     🟡 10 | **No hay greeting/Get Started configurado en Messenger Profile**.                                                                                                                                                                                                                                                                             | No hay helper/ruta para Messenger Profile API.                                                                                                                                        | Configurarlo manualmente en panel/API o dejarlo fuera de la demo.                                                                                                                                                          | Si                                          |
|     🟡 11 | **Error 190 / token caducado no notifica al admin**.                                                                                                                                                                                                                                                                                          | `sendMetaTextMessage()` persiste fallo via `providerResponse`, pero no alerta.                                                                                                        | Mostrar alerta en UI o notificacion operativa cuando Meta devuelve token invalido.                                                                                                                                         | Si                                          |
|     ✅ 12 | **Footer publico con links legales completos**.                                                                                                                                                                                                                                                                                               | `apps/web/components/site-footer.tsx`.                                                                                                                                                | Footer enlaza `Privacy`, `Data Deletion`, `Terms` y `info@resender.dev`.                                                                                                                                                   | Hecho                                       |

## 6. Checklist recomendado antes de enviar
### Codigo
1. `/terms` creado y enlazado en footer.
2. Suscripcion al webhook all-or-nothing implementada.
3. Restringir `webhookUrl` a HTTPS en produccion.
4. Desuscribir en Meta cuando el usuario desconecta una Page.
5. Opcional: agregar `messaging_policy_enforcement`.
6. Opcional: procesar `GET_STARTED`/postbacks o ajustar la demo para no depender de eso.

### Operacion / panel Meta
1. Mantener el `config_id` con exactamente los permisos decididos: `pages_manage_metadata`, `pages_messaging`, `pages_show_list`.
2. Privacy Policy URL publica guardada: `https://resender.dev/privacy` (URL verificada publicamente).
3. Data Deletion Instructions URL publica guardada: `https://resender.dev/data-deletion` (URL verificada publicamente).
4. App Icon cargado.
5. Categoria seleccionada: Bots de Messenger para empresas.
6. Email de contacto/notificaciones: `info@resender.dev` (buzon real).
7. Page asociada/publicada desde AI Beat.
8. Crear cuenta de revision preconfigurada para el revisor.
9. Conectar una Page de revision real dentro de esa cuenta.
10. Usuario Messenger de prueba confirmado como tester y relacionado en Resender para que sus DMs lleguen al webhook en modo Development.
11. Configurar `webhookUrl` de la Page hacia una automatizacion externa que responda automaticamente por `/api/meta/send`.
12. Screencast end-to-end disponible: `https://www.youtube.com/watch?v=iLLVMWvRhFo`.
13. Page demo: `https://www.facebook.com/profile.php?id=61584495695858`.
14. Usuario de revision: `demo@resender.dev`; password final definido fuera del repo.
15. Notas de revision listas para pegar en Meta App Review. No guardar passwords en archivos versionados y rotar el password al terminar la revision.

## 7. Riesgo principal de producto
Meta revisa `pages_messaging` como una experiencia interactiva de Messenger. Resender solo garantiza recepcion, persistencia, reenvio y endpoint de respuesta. Por eso, para App Review hay que demostrar una experiencia completa:

1. El revisor inicia sesion en Resender.
2. Ve una Page conectada.
3. Envia un DM a la Page.
4. Resender recibe y registra el mensaje.
5. La automatizacion externa recibe el push.
6. La automatizacion responde por `/api/meta/send`.
7. El revisor recibe la respuesta en Messenger.

Sin esa automatizacion demo, el producto puede estar tecnicamente correcto y aun asi fallar App Review. La cuenta de revision debe estar lista para que el revisor solo inicie sesion en Resender, vea la Page conectada, envie un DM a esa Page y confirme que la conversacion y la respuesta aparecen.

## 8. No solicitar permisos fuera de Messenger
Solo Messenger esta implementado. Instagram (`prd_instagram.md` / `prd_insta_review.md`) sigue siendo plan/documentacion, no codigo productivo completo.

No solicitar permisos de Instagram en esta revision.

## 9. Archivos clave para continuar
- `apps/web/app/privacy/page.tsx`
- `apps/web/app/data-deletion/page.tsx`
- `apps/web/components/site-footer.tsx`
- `apps/web/app/api/meta/{start,callback,webhook,send}/route.ts`
- `apps/web/lib/meta.ts`
- `apps/web/lib/inbound/meta-webhook.ts`
- `apps/web/lib/inbound/inbound-ingestion.ts`
- `apps/web/lib/pages/page-registry.ts`
- `apps/web/lib/pages/webhook-url.ts`
- `apps/web/features/account/actions.ts`
- `apps/web/db/migrations/0001_mvp_foundation.sql`
- `apps/web/db/migrations/0002_account_deletion_cascade.sql`
- `CONTEXT.md`

## 10. Nota sobre fuentes externas
En la auditoria del 2026-06-20 se intento verificar documentacion actual de Meta con Context7. Context7 solo devolvio documentacion general de Meta Developers, no el detalle fino de Messenger App Review; `developers.facebook.com` respondio 429 desde el entorno. Por eso esta guia se basa en:

1. El handoff/requisitos ya extraidos en `fb_requirements.md`.
2. Auditoria directa del codigo actual.
3. Requisitos operativos conocidos de App Review que deben confirmarse en el panel Meta antes de enviar.
