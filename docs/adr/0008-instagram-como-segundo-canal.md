---
status: accepted
---

# Instagram como segundo canal: `channel` sobre cuentas conectadas y tabla propia para comentarios

Hasta esta entrega Resender operaba un solo canal. Todo el modelo estaba cableado a "páginas
de Facebook": `connected_pages.meta_page_id` con un `unique` **global**, `PageSchema.provider`
como `z.literal("meta")`, `graph.facebook.com` en el cliente de envío y un único webhook
firmado con `META_APP_SECRET`. Un segundo canal choca con eso antes de escribir una línea de
lógica.

La decisión es agregar **Instagram** —DMs y comentarios— como un canal más sobre la plomería
existente, en vez de un vertical paralelo. Reemplaza lo que proponía `prd_instagram.md` en su
versión original: rutas `/api/instagram/*` y comentarios fuera de alcance.

## Considered Options

- **Instagram con Facebook Login for Business** (`instagram_business_account` colgando de una
  Página) — rechazado. Obliga al negocio a tener y vincular una Página de Facebook para atender
  su propio Instagram, que es exactamente la fricción que el canal viene a resolver. Además
  mezcla los permisos `pages_*` del envío a App Review de Messenger con los de Instagram.
- **Instagram API con Instagram Login** (`graph.instagram.com`) — elegido. Es el camino
  recomendado por Meta y no requiere Página de Facebook: el negocio inicia sesión con su cuenta
  profesional y autoriza **una** cuenta.
- **`provider = "instagram"` como valor nuevo del discriminador que ya existía** — rechazado.
  Instagram **es** Meta: comparten la app, el sobre de error de Graph, la firma del webhook. Lo
  que cambia es la superficie, no el proveedor. Meterlo en `provider` haría que el día que
  exista un proveedor que no sea Meta las dos dimensiones se pisen.
- **Comentarios dentro de `messages`, con un `event_type`** — rechazado. Un comentario cuelga de
  una publicación, se anida en un hilo y su respuesta pública no tiene ventana de 24 horas.
  Habría pedido media docena de columnas nullable y una semántica prestada.

## Decisiones de dominio

- **`channel` es un campo aparte de `provider`.** `provider` sigue valiendo `"meta"` en los dos
  canales y `connected_pages` gana `channel in ('messenger','instagram')` con default
  `'messenger'`, para que las filas existentes queden correctas sin backfill.
  `connected_pages` deja de significar "páginas de Facebook" y pasa a significar **cuentas
  conectadas**.
- **El `unique` global sobre `meta_page_id` se reemplaza por `(channel, meta_page_id)`.** Los
  IDs de página de Facebook y los de cuenta de Instagram viven en namespaces distintos: un ID
  repetido entre canales es legítimo y bloquearlo dejaría a un tenant sin conectar su cuenta por
  una colisión que no significa nada.
- **Toda resolución por `meta_page_id` recibe `channel` obligatorio y sin default.** Un default
  habría convertido "me olvidé de decidir" en "Messenger" sin que nadie lo note, y el evento
  habría resuelto al tenant equivocado.
- **Las rutas son las de Facebook con `/instagram` insertado**, no un árbol nuevo:
  `/api/meta/instagram/{start,callback,webhook,send}` y
  `/api/meta/instagram/comments/{reply,private-reply}` en `apps/web`;
  `/webhooks/meta/instagram` y el recurso `/v1/comments` en `apps/api`. Los `GET` de lectura no
  se duplican: se filtran por `channel`.
- **El webhook de Instagram tiene ruta y secreto propios.** `INSTAGRAM_APP_SECRET` **no** es
  `META_APP_SECRET`. Compartir la ruta obligaría a adivinar con cuál verificar cada payload —o a
  probar los dos, que es peor—. Rutas separadas hacen que la pregunta no exista. El verify token
  también es propio porque cada webhook se registra por separado en el panel de Meta.
- **Sin pantalla de selección.** La ADR 0004 mandó la selección a una pantalla aparte porque
  Facebook devuelve N páginas y persistir los tokens de las no elegidas era el problema.
  Instagram Login autoriza exactamente una cuenta: el callback escribe directo.
- **El orden del callback es intercambio → perfil → suscripción al webhook → persistencia.** Una
  cuenta guardada que no recibe eventos se ve conectada y está muda; una suscripción sin fila en
  la base no le hace nada a nadie y se limpia sola al reintentar.
- **Los comentarios van a `instagram_comments`.** `conversations`/`messages` quedan solo para
  DMs. La **respuesta privada** sí es un DM y se persiste en `messages`, con
  `instagram_source_comment_id` como única marca de que nació de un comentario.
- **`external_webhook_deliveries` y `external_webhook_jobs` aceptan mensaje _o_ comentario**, con
  `check (num_nonnulls(...) = 1)`, en vez de duplicar la bitácora de entregas: el consumidor y la
  política de reintentos son idénticos.
- **Instagram queda fuera de cuota y fuera del cupo de páginas.** ⚠️ **Superseded in part by
  ADR 0010**, que revirtió esta decisión: el cupo pasó a medirse en cuentas conectadas de
  cualquier canal y las tres superficies de Instagram consumen cuota. Se conserva escrita
  porque explica la forma que tuvo el código hasta entonces. El [Gate de suscripcion] sí
  aplica. Es una decisión de negocio provisional —los planes publicados hablan de páginas de
  Facebook— y por eso el punto exacto donde vuelve el entitlement está marcado con un comentario
  en cada una de las dos rutas de envío.
- **El texto se mide distinto en cada superficie**: un DM de Instagram admite **1000 bytes
  UTF-8**; un comentario, **2200 caracteres** (code points, no unidades UTF-16). Se valida antes
  de llamar a Meta, porque su rechazo no dice cuánto sobró.
- **Una sola respuesta privada por comentario, verificada contra nuestra propia base** antes de
  llamar a Meta, y devuelta como `409` explícito. Meta lo rechaza con un `100/2534025` que junta
  cuatro causas distintas y no dice cuál.
- **Tres catálogos de traducción de errores de Graph** —Messenger, DM de Instagram, comentario—
  y no uno. Los códigos coinciden pero **lo que el usuario tiene que hacer es distinto**, y ese
  es el punto entero de traducir un error: un `10` es la ventana de 24 h en un DM y un permiso
  faltante en una respuesta pública, que no tiene ventana. Los tres motivos que no dependen de
  qué se estaba enviando —token vencido, rate limit, bloqueo por política— viven una sola vez.
- **Se implementa en los dos workers**, `apps/web` y `apps/api`, en la misma entrega. `web`
  atiende producción hoy; `api` la va a atender después de la fase 2, y hacerlo ahora evita
  rehacerlo.

## Consequences

- **La migración `0013` rompe consultas de `apps/api` que nadie iba a tocar.** Al reemplazar
  constraints, `on conflict (meta_page_id)` y `on conflict (message_id)` dejan de resolver y
  Postgres falla en tiempo de ejecución. Regla que queda: **antes de tocar un constraint,
  grepear `on conflict` en los dos workers**; y antes de cambiar la cardinalidad de una FK,
  grepear los `join` que la usan —un `on conflict` roto grita, un `join` interno que perdió
  filas no dice nada.
- **El payload que reciben los sistemas externos cambia de forma aditiva**: `type: "message" |
  "comment"` como discriminador, y `page.channel` / `page.username` siempre presentes (con
  `username` en `null` en Messenger). Agregar campos no rompe a los consumidores existentes.
- **El anti-bucle de comentarios necesita tres señales** y no una. En DMs alcanza `is_echo`; en
  comentarios ese campo no existe. Quedan `from.id === entry.id` en el parser,
  `from.username === page.username` en la ingesta, y —la única que no depende del `from` que
  manda Meta— que el `ig_comment_id` sea de una fila `outbound` nuestra.
- **Los tokens de Instagram vencen a los ~60 días.** `token_expires_at` se persiste y
  `refreshInstagramToken` existe en los dos workers, pero **todavía no hay cron que los use**.
  A los ~60 días de la primera cuenta conectada eso deja de ser teórico.
- **App Review**: el envío vigente de Messenger (ADR previo, `pages_messaging`,
  `pages_manage_metadata`, `pages_show_list`) no se toca. Instagram exige su propio Advanced
  Access de `instagram_business_manage_messages` e `instagram_business_manage_comments`, con
  verificación de negocio. Hasta entonces el canal solo sirve para cuentas propias o de prueba.
- **El contador de páginas del plan cuenta solo Messenger**, y la UI lo dice literalmente
  ("N de M páginas de Facebook"): si dijera "páginas" a secas, el usuario buscaría por qué su
  cuenta de Instagram no suma. ⚠️ **Revertido por la ADR 0010**: hoy cuenta los dos canales y
  la UI dice "N de M cuentas conectadas".
- La app de Meta usada durante el desarrollo es una separada ("Resender.dev - Test1"); la
  productiva no se tocó.
