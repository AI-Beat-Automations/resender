# ADR 0014 — Plantillas de WhatsApp: Meta es dueño, Resender administra y envía

- **Estado:** aceptado
- **Fecha:** 2026-08-28
- **Supersede:** [ADR 0013](0013-whatsapp-como-tercer-canal.md) §«La ventana de
  24 h se aplica localmente y no hay plantillas» y su punto 2 de «Cuándo revisar
  esta decisión»
- **Supersede:** `prd_whatsapp.md` §«Regla explícita sobre plantillas»
- **Se apoya en:** [ADR 0001](0001-whatsapp-direct-cloud-api-tech-provider.md)
  (Cloud API directa como Tech Provider), [ADR 0010](0010-permiso-de-instagram-por-cuenta.md)
  (permiso por cuenta), [ADR 0012](0012-un-solo-worker-next-sin-api-separada.md)
  (un solo Worker)

## Contexto

La [ADR 0013](0013-whatsapp-como-tercer-canal.md) dejó el canal funcionando sin
plantillas y anticipó esta fase con precisión:

> Las plantillas son la fase siguiente y rompen tres supuestos de esta: que el
> usuario final escribe primero, que la ventana de 24 h es la única regla de
> envío, y que no administramos assets de mensajería en Meta. **No se acomodan
> como un tipo de mensaje más.**

Esta ADR rompe los tres a propósito y registra a cambio de qué.

Lo que hay que saber de las plantillas para entender las decisiones, y que no es
obvio desde el código:

- **La identidad es `(nombre, idioma)`, no el nombre.** La misma plantilla en
  cinco idiomas son cinco plantillas y cada una cuenta contra el tope de la
  WABA. No hay «una plantilla con traducciones».
- **Al enviar sólo se acepta `name` + `language`.** El cuerpo es
  `template: { name, language: { code }, components }`. Meta **no expone ningún
  campo de id** en el envío: cualquier otra clave que inventemos hay que
  traducirla antes de llamar.
- **La plantilla vive en la WABA, no en el número.** Y una WABA puede tener
  números de tenants distintos: `countActiveWhatsappNumbersInWaba` ya cruza
  tenants por esta misma razón. Dos clientes nuestros pueden compartir catálogo
  sin saberlo.
- **Editarla la devuelve a revisión.** Meta revisa automáticamente al crear y
  al editar, así que una edición deja la plantilla sin poder enviarse hasta que
  se re-apruebe.
- **Borrar por nombre borra todos los idiomas** y **quema el nombre 30 días**.
  El borrado por `hsm_id` alcanza una sola versión.
- **El catálogo de estados no es estable.** La doc de Meta usa `PENDING` en unas
  páginas e `IN_REVIEW` en otras, y aparece un `LIMIT_EXCEEDED` que no está en
  la lista canónica.

## Decisiones

### El envío entra por una ruta nueva, no extendiendo la existente

`POST /api/meta/whatsapp/templates/send`, con los mismos gates de
`/whatsapp/send` menos el de la ventana de 24 h, que es justamente el que la
plantilla existe para saltar.

La alternativa —un `{ template }` en el body de `/whatsapp/send`— obligaba a
tocar `parseOutboundSendInput`, que es **neutral de canal** y lo comparten
Messenger, Instagram y WhatsApp. Un XOR de tres ramas en un parser que dos
canales no pueden usar es costo permanente para los tres a cambio de ahorrar una
ruta. El precio de la ruta nueva —repetir ocho gates— se paga extrayéndolos a un
helper compartido, que además es refactor deseable de por sí.

Se envía **síncrono**, igual que el free-form. La cola `whatsapp-jobs` existe y
migrar después es barato; pasar a `202` hoy obligaría a todo cliente a
implementar el webhook sólo para saber si su mensaje salió. El envío masivo es
una feature con nombre propio y todavía no existe.

### La plantilla se direcciona por nombre e idioma

Es lo único que Meta acepta. Exponer el id de Meta —o un id nuestro— habría
puesto una traducción obligatoria delante de cada envío, sostenida por una copia
local que esta misma ADR declara no autoritativa. Se rechazó por eso, no por
estética: convierte un hueco del espejo en un envío fallido.

### El idioma tiene una forma canónica, y la impone el registry

Meta escribe el mismo idioma de dos maneras según por dónde entre: el catálogo
de Graph y el `template.language.code` del envío usan guion bajo (`en_US`), y
los webhooks de plantilla usan guion (`en-US`, y a veces `en` a secas). Como la
clave del espejo es `(waba_id, name, language)`, dos formas de la clave son dos
filas para la misma plantilla: el `update` del webhook **nunca** encontraría la
fila que insertó el sync. Y el fallo no se ve —no hay error, no hay fila nueva,
y el gate del envío sigue decidiendo contra un estado viejo—, así que el espejo
se congelaría en silencio hasta que alguien lo notara a mano.

La forma canónica es la del guion bajo, y no es una moneda al aire: este valor
no se queda en casa, sale por el `GET` del CRUD y vuelve tal cual en el
`language` del envío, así que guardar una variante que Meta no acepta sería peor
que no normalizar. Por lo mismo se canoniza el uso de mayúsculas de la región
(`en_us` → `en_US`), que es la forma fija del catálogo de idiomas de Meta. Lo
que no tiene forma de código de idioma se deja como llegó: inventar sobre un
valor que no entendemos es la otra manera de perder la fila.

`normalizeWhatsappTemplateLanguage` vive en `template-registry.ts` y se aplica
**adentro del módulo**, en todas las escrituras y en todas las lecturas por
clave. No en el parser, que es puro y reporta lo que Meta mandó sin conocer la
otra punta; y no en cada llamador, que es exactamente donde se olvida. Metida en
el registry, ningún llamador puede saltearla.

### El espejo es mínimo y no está en el camino crítico

Se guarda `(waba_id, name, language, status)` y nada más. **No se espejan los
`components`.** Meta es dueño de la plantilla; nuestra copia sirve para listarla
y para saber si está aprobada.

La consecuencia deliberada es que el envío **falla abierto**: si el espejo tiene
la fila y no está `APPROVED`, se rechaza sin llamar a Meta; si no tiene la fila,
se envía igual. Un hueco del espejo es un estado legítimo —una plantilla creada
en WhatsApp Manager después del último sync— y rechazar por eso sería negarle al
cliente un envío válido por una carencia nuestra.

Por lo mismo **no se valida el número de parámetros**. El conteo es lo que más
fácil se desactualiza (una edición cambia las variables y el webhook de estado no
trae contenido), y un falso rechazo nuestro es peor que un rechazo de Meta:
contra el nuestro el cliente no puede hacer nada.

`status` se guarda **como texto libre, sin check constraint**, contra la
costumbre del repo. El catálogo de Meta no es estable —`PENDING` e `IN_REVIEW`
para el mismo hecho según qué página se lea, y un `LIMIT_EXCEEDED` y un
`IN_APPEAL` que no están en la lista canónica—, y una fila que no se puede
insertar deja el espejo peor que un valor que no sabemos nombrar: perderíamos la
plantilla entera —nombre, idioma, hsm id— por no saber leer su estado. El
catálogo cerrado **más `unknown`**, que es el mismo patrón que `attachment_type`
en la migración 0017, vive entonces en el módulo de lectura
(`lib/whatsapp-templates/template-registry.ts`): normaliza al leer, conserva el
literal de Meta en `rawStatus` —para que el cliente pueda ver un estado nuevo
antes de que nosotros lo modelemos— y lo que no reconocemos no se envía.

### La fila es de la WABA, con marca de quién la creó

`unique (waba_id, name, language)`, más una columna que registra qué tenant la
creó desde Resender. Llavearla por tenant habría hecho que dos filas describan
el mismo objeto de Meta y se contradigan.

El precio, aceptado explícitamente: **un tenant ve los nombres de las plantillas
de otro** cuando comparten WABA. Es información de un recurso que efectivamente
comparten, y la alternativa —ocultarlas— produce un catálogo que miente sobre lo
que ese número puede enviar.

### El borrado es por `hsm_id` y sólo de las propias

Contra lo que Meta permite, y a propósito:

- **Por `hsm_id` y no por nombre.** Borrar por nombre se lleva todas las
  versiones de idioma. Quien quiera borrar cinco puede pedirlo cinco veces;
  quien no lo quería no pierde cuatro.
- **Sólo las que el tenant creó desde Resender.** En una WABA compartida, «no
  puedo borrar esta» es un mal día y «me borraron las plantillas» es un
  incidente, agravado porque el nombre queda quemado 30 días. Las plantillas
  importadas por el sync inicial son read-only: para borrarlas se va a WhatsApp
  Manager.

### El editor v1 hace `body` y `footer`, y nada más

Categorías `utility` y `marketing`. Se dejan fuera:

- **El header de media**, porque exige subir un handle por la Resumable Upload
  API — es decir, **Resender hospedando media saliente**, que la ADR 0013 cerró
  con argumento propio. No es un campo más del formulario, es reabrir una
  decisión de arquitectura.
- **Las plantillas `authentication`**, que tienen forma restringida y reglas de
  OTP propias. Es un producto aparte, no una categoría más del `select`.

El CRUD se expone además en la **API pública**
(`/api/meta/whatsapp/templates`). La consola **no la consume**: sus Server
Actions llaman a `lib/*` directo, como toda la consola desde la ADR 0012 —un
solo Worker, ninguna pantalla hace `fetch` a su propia API pública—, y se
autentican con la sesión y no con una API key.

Lo que las dos superficies sí comparten es la orquestación —resolver la WABA del
número, comprobar quién creó la fila, llamar a Graph, espejar el resultado—, y
por eso vive en `lib/whatsapp-templates/template-admin.ts` y no en los route
handlers. Si viviera en las rutas, la consola tendría que reescribirla entera; y
dos copias de una regla de propiedad no divergen de golpe, divergen el día que
alguien arregla una sola. El precio de esa divergencia tiene nombre: un `PATCH`
que se olvidó de mirar `created_by_tenant_id` es un tenant editando la plantilla
de otro en una WABA compartida. Las rutas quedan como transporte —qué es un 200,
qué es un 400, qué se escribe en el log— y por eso el módulo devuelve resultados
discriminados en vez de lanzar: «esta plantilla es ajena» es un 403 lo pida
quien lo pida.

Los gates de la ruta son los del envío menos los de mensajería: sin cuota, sin
conversación y sin ventana, pero **con suscripción activa** — crear plantillas
deja efectos permanentes en la WABA del cliente y no queremos eso disponible
para una cuenta que dejó de pagar.

Editar una plantilla aprobada **se permite, con aviso** en la UI. Prohibirlo
llenaría la WABA de `nombre_v2`, `_v3` contra un tope de 6.000 y 100 creaciones
por hora, y la consecuencia de editar es reversible: se re-aprueba sola.

### La suscripción del flujo estándar sigue pelada

Los tres campos de plantilla (`message_template_status_update`,
`template_category_update` y el de calidad) se agregan a la lista explícita de
**Coexistence**. El flujo estándar sigue llamando a `subscribed_apps` **sin
`subscribed_fields`**, como hoy.

El motivo está en el código desde la fase anterior: pasar una lista **estrecha**
la suscripción a lo que alguien se acordó de enumerar. Hacer explícito el flujo
estándar habría convertido una omisión futura en «`messages` dejó de llegar para
todos los números nuevos», en silencio.

El webhook de calidad no es opcional: no hay tope local de plantillas hacia
contactos que nunca contestaron —Meta ya tiene sus messaging limits y un número
inventado por nosotros estorbaría a un caso legítimo antes de salvar a nadie—,
así que la calidad que reporta Meta es el **único** freno del que nos enteramos.

### Del webhook entra a la base el estado; el motivo del rechazo, sólo al log

Un `message_template_status_update` con `REJECTED` trae además `rejection_info`:
el motivo en prosa y, a veces, la recomendación para corregir la plantilla. El
parser lo lee (`lib/inbound/whatsapp-parsers/templates.ts`), pero el espejo no
tiene dónde ponerlo —la 0018 guarda `(waba_id, name, language, status)` y nada
más—, así que la ingestión lo escribe en el log
(`templateRejectionReason` / `templateRejectionRecommendation` en
`lib/inbound/inbound-ingestion.ts`) y ahí termina. Se puede escribir tal cual
porque es catálogo del negocio y no contenido del contacto: lo que no se loguea
nunca son los `components` con los que se hidrata un envío.

La consecuencia visible es que la consola sabe que la plantilla está `REJECTED`
pero no por qué, y lo explica con copy genérica que manda a WhatsApp Manager. Se
acepta para esta entrega —el motivo no se pierde, queda en el log, que es lo que
convierte «rechazada otra vez» en una pregunta contestable— y queda como deuda
con precio conocido: ahora que el parser ya lo lee, persistirlo es una columna y
un `set`.

### El envío deja fila en `messages`, con lo enviado y no con la plantilla

`text = ''` y una columna `template_meta` jsonb con nombre, idioma y los
`components` **de ese envío**. Guardar el mensaje y no la plantilla es lo que le
permite al Inbox mostrar qué se le mandó al contacto sin depender de un espejo
que puede haber derivado, y lo que evita un segundo vocabulario de plantillas
dentro de `messages`.

Lo que se ve en el hilo es, entonces, **la identidad de la plantilla —`nombre ·
idioma`, que es el identificador que usa Meta— y los valores que viajaron, en el
orden en que viajaron**. No una frase con las variables sustituidas, y no por
una carencia de la vista: el cuerpo aprobado no está en ninguna parte.
`template_meta` guarda los parámetros de ese envío y no el texto de la
plantilla, que es lo correcto porque es lo que el contacto recibió; y el espejo
no guarda los `components`, por la decisión de arriba. Aunque los guardara
tampoco alcanzaría: una edición devuelve la plantilla a revisión y su contenido
no se resincroniza, así que reconstruir la burbuja desde el catálogo mostraría
lo que la plantilla dice **hoy** y no lo que se envió aquel día. Un texto
plausible y falso es peor que un texto parcial y cierto.

El caso normal —un solo `body`— sale bien parado igual: el orden plano de los
valores **es** el de los marcadores (`{{1}}`, `{{2}}`, …), así que quien lee el
hilo reconoce los datos aunque le falte la frase que los enlaza. El argumento
entero, y lo que haría falta para que fuera sustitución de verdad, está en
`lib/messages/template-display.ts`.

Una plantilla enviada **consume cuota**, 1 por envío, igual que cualquier
saliente que Meta acepte. Contabilizarla aparte sería modelar un plan de precios
que todavía no existe.

## Consecuencias

- Al conectar un número se sincroniza el catálogo de plantillas de su WABA,
  paginado y en la cola `whatsapp-jobs`. Una WABA puede tener 6.000.
- El `409 customer_service_window_closed` cambia de significado:
  `templateSendingSupported` pasa a `true` y el mensaje deja de decir «esperá a
  que el contacto escriba».
- Los límites de Meta (6.000 por WABA, 100 creaciones por hora) no se modelan;
  se traduce su error en el catálogo de `explainWhatsappError`.
- No se resincroniza el contenido de las plantillas. Sólo `status` se mantiene
  fresco, por webhook.
- La 0018 no queda librada a una verificación a mano en preview:
  `db/migrations/migrations.test.ts` la corre sobre PGlite y prueba las tres
  decisiones que más fácil se «arreglan» en una revisión distraída —la clave por
  WABA, el `on delete set null` del dueño y el `status` sin check—, más la fila
  de un envío de plantilla con `template_meta` y sin adjunto.

## Deuda declarada

- **`template` significa dos cosas.** El catálogo de `attachment_type` ya usa
  `template` para la tarjeta con botones de Messenger, que no tiene ninguna
  relación con una plantilla de WhatsApp. Una [Plantilla] **no** se persiste como
  adjunto, así que las dos no se mezclan en la misma fila; pero el nombre
  colisiona en el glosario y en el check constraint. El rename queda pendiente.
- **La lista explícita de Coexistence puede estar estrechando la suscripción de
  más.** Si `subscribed_fields` reemplaza en vez de sumar, un número conectado
  por Coexistence está suscrito a `history`, `smb_app_state_sync` y
  `smb_message_echoes`, y **`messages` no está en la lista**. Es un bug
  preexistente e independiente de esta fase; hay que verificarlo con un
  `GET /{waba_id}/subscribed_apps` sobre una conexión real.
- **El motivo del rechazo no le llega al usuario.** Meta lo manda en
  `rejection_info`, el parser ya lo lee y la ingestión lo escribe sólo en el
  log; la 0018 no tiene columna para él, así que la consola explica un `REJECTED`
  con copy genérica que manda a WhatsApp Manager. Persistirlo es barato ahora
  que el dato ya entra: una columna en el espejo y escribirla en el mismo
  `update` del webhook.
- **La burbuja del Inbox no sustituye variables**, y para que lo hiciera hay que
  persistir el cuerpo aprobado dentro de `template_meta` en el mismo `insert`
  del envío —el único instante en que se puede afirmar contra qué versión se
  envió— y reemplazar los `{{n}}` en la vista. Es una decisión de esquema y de
  la ruta de envío, no de la vista, y por eso queda escrita y no hecha.
- **`templates` es un miembro intruso de `WhatsappOnboardingStep`**
  (`lib/meta/whatsapp-client.ts`). No es un paso del onboarding: entró porque
  `graphRequest` exige un `step` para atribuir un fallo de red y ahora también
  lo usa la administración de plantillas, que ocurre cuando se le antoja al
  cliente y fuera de todo flujo de conexión. Las alternativas —un segundo tipo
  casi idéntico, o mentir con `assets`— costaban más que el miembro extra. Si el
  CRUD llega a tener pasos propios, ése es el valor que se parte.
- **La forma exacta del envío está confirmada por implementaciones de terceros,
  no por la doc de Meta**, que devolvía 500 en sus páginas de plantillas al
  escribir esto. Confirmar empíricamente antes de construir.

## Cuándo revisar esta decisión

1. **Cuando alguien pida enviar plantillas a miles de contactos.** Ahí el envío
   síncrono deja de servir y la cola `whatsapp-jobs` pasa a ser el camino, con
   el `202` y el cambio de contrato que eso implica.
2. **Cuando un cliente necesite header con imagen.** No es un campo más: obliga
   a decidir si Resender hospeda media saliente, cerrado en la ADR 0013.
3. **Cuando el catálogo compartido moleste.** Si un cliente objeta ver nombres
   de plantillas de otro tenant en su WABA, la salida no es ocultarlas sino
   dejar de compartir WABA, que es una decisión de onboarding.
4. **Cuando haga falta cobrar las plantillas distinto** que un mensaje de
   atención. Hoy consumen la misma unidad de cuota.
