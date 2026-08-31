-- migration 0018: el espejo de las plantillas de WhatsApp
--
-- Una plantilla es el único mensaje que WhatsApp acepta con la ventana de
-- atención cerrada, y por lo tanto la única forma de que el negocio escriba
-- primero. **Meta es dueño de la plantilla y esto es una copia que no manda**
-- (ADR 0014): sirve para listar el catálogo de un número y para saber si una
-- plantilla está aprobada, nunca para decidir qué se envía. De ahí que el envío
-- falle abierto —fila presente y no aprobada, se rechaza sin llamar a Meta;
-- fila ausente, se envía igual y decide Meta—, porque un hueco del espejo es un
-- estado legítimo: una plantilla creada en WhatsApp Manager después del último
-- sync.
--
-- Lo que **no** trae, a propósito: los `components`, porque el contenido es de
-- Meta y una copia que deriva miente sobre lo que se va a entregar (sólo el
-- `status` se mantiene fresco, por webhook); y ningún `param_count`, que se
-- evaluó y se descartó — no validamos el conteo de parámetros, así que sería una
-- columna sin lector y que además puede mentir después de una edición.

create table if not exists whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  waba_id text not null,
  name text not null,
  language text not null,
  -- El id de Meta (hsm id). Es lo único con lo que se puede borrar una sola
  -- versión de idioma: el DELETE por `name` se lleva todas.
  meta_template_id text,
  category text check (category is null or category in ('utility', 'marketing', 'authentication')),
  status text not null,
  -- Qué tenant la creó desde Resender. `null` es «vino del sync» o «la creó
  -- alguien que ya no existe», y las dos se tratan igual: read-only.
  created_by_tenant_id uuid references users(id) on delete set null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (waba_id, name, language)
);

-- Los cuatro puntos que no son cosméticos:
--
-- 1. **`unique (waba_id, name, language)` y no `(tenant_id, ...)`.** La
--    identidad de una plantilla en Meta es el par nombre+idioma —la misma
--    plantilla en cinco idiomas son cinco plantillas, cada una contra el tope de
--    la WABA— y la plantilla vive en la WABA, no en el número. Como una WABA
--    puede tener números de tenants distintos (`countActiveWhatsappNumbersInWaba`
--    ya cruza tenants por esta misma razón), llavear por tenant haría que dos
--    filas describan el mismo objeto de Meta y se contradigan entre sí. El
--    precio está aceptado y escrito en la ADR 0014: un tenant ve los nombres de
--    las plantillas de otro cuando comparten WABA.
--
-- 2. **`created_by_tenant_id` es `on delete set null`, no cascade.** La 0002
--    borra la cuenta con `delete from users` y FKs en cascade; acá eso borraría
--    una fila que describe una plantilla que **sigue existiendo en Meta** y que
--    otro tenant de la misma WABA puede estar enviando. Al perder el dueño la
--    plantilla queda read-only para todos —que es exactamente lo que significa
--    `null` en esta columna— y eso es el resultado correcto: nadie hereda el
--    derecho a borrar algo que no creó, y el nombre queda quemado 30 días si se
--    borra por error.
--
-- 3. **`status` sin check constraint,** contra la costumbre del repo. El
--    catálogo de estados de Meta no es estable: su doc usa `PENDING` en unas
--    páginas e `IN_REVIEW` en otras, y aparecen `LIMIT_EXCEEDED` e `IN_APPEAL`
--    que no están en la lista canónica. Una fila que no se puede insertar deja
--    el espejo peor que un valor que no reconocemos: perderíamos la plantilla
--    entera —nombre, idioma, hsm id— por no saber nombrar su estado. La
--    normalización a `unknown` se hace **en el módulo de lectura**
--    (`lib/whatsapp-templates/template-registry.ts`), con el mismo patrón que
--    `attachment_type`, y lo que no reconocemos no se envía.
--
-- 4. **La categoría sí lleva check**, al revés que el estado: las tres son un
--    vocabulario de producto que elegimos nosotros al crear la plantilla, no un
--    dato que Meta nos empuje por webhook con valores nuevos.
--
-- Sin índices adicionales: el unique de arriba es el índice que sirve los tres
-- accesos del espejo —el gate del envío busca por `(waba_id, name, language)`
-- exacto, el listado del CRUD por `waba_id` (prefijo izquierdo) y el update del
-- webhook por la clave entera—, y `PATCH`/`DELETE` entran por la primary key.

-- `messages.template_meta` y no `attachment_type = 'template'`.
--
-- Una plantilla de WhatsApp **no** es un adjunto: el `template` que ya está en
-- el catálogo de `attachment_type` (0016, ampliado en la 0017 §6) es la tarjeta
-- con botones de Messenger y no tiene ninguna relación más que el nombre, que
-- colisiona por herencia de Meta. Reusar ese valor mezclaría dos cosas
-- distintas en el mismo discriminador y dejaría a toda rama de la UI que hoy
-- pinta una tarjeta de Messenger recibiendo envíos de WhatsApp. En un envío de
-- plantilla `attachment_type` queda `null`.
--
-- Guarda `{ name, language, components }` **de ese envío** y no de la plantilla:
-- es lo que le permite al Inbox mostrar qué se le mandó al contacto sin depender
-- de un espejo que puede haber derivado. Lo que la burbuja pinta es la identidad
-- de la plantilla —nombre e idioma— y los valores que viajaron, en el orden en
-- que viajaron; **no es una frase con las variables sustituidas**, y no puede
-- serlo: acá viajan los parámetros y no el cuerpo aprobado, que no se guarda en
-- ningún lado —el espejo tampoco espeja los `components`—. El argumento entero
-- está en `lib/messages/template-display.ts`.
-- El rename del `template` del catálogo de adjuntos queda como deuda declarada
-- en la ADR 0014.

alter table messages
  add column if not exists template_meta jsonb;
