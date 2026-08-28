# ADR 0013 — WhatsApp como tercer canal: Cloud API directa, Coexistence y media en R2

- **Estado:** aceptado
- **Fecha:** 2026-08-24
- **Implementa:** `prd_whatsapp.md` (versión del 24 de agosto de 2026)
- **Se apoya en:** [ADR 0001](0001-whatsapp-direct-cloud-api-tech-provider.md) (Cloud API
  directa como Tech Provider), [ADR 0010](0010-permiso-de-instagram-por-cuenta.md)
  (permiso por cuenta), [ADR 0011](0011-cupo-por-conexion-e-instagram-en-facturacion.md)
  (cupo por conexión), [ADR 0012](0012-un-solo-worker-next-sin-api-separada.md)
  (un solo Worker)

## Contexto

Resender opera dos canales: Messenger desde el principio e Instagram desde la
[ADR 0008](0008-instagram-como-segundo-canal.md). WhatsApp es el tercero, y es
el primero que no entra sobre la plomería existente sin negociar nada.

Lo que lo distingue de los otros dos:

- **Trae bytes.** Messenger e Instagram entregan adjuntos como URLs de Meta que
  se guardan como texto. WhatsApp entrega un `media id` cuya URL de descarga
  dura **5 minutos** y cuyo id vive 7 días. O se baja el archivo en el acto o se
  pierde. Eso mete almacenamiento de objetos en un producto que hasta hoy solo
  tenía Postgres, y con él costo por GB, retención, ownership y borrado.
- **No puede iniciar conversaciones.** Sin plantillas —fuera de alcance en esta
  fase— el producto solo responde dentro de la ventana de 24 h que abre el
  usuario final. Es una limitación de producto, no un detalle técnico: cambia lo
  que se puede prometer en la UI, en la API y en marketing.
- **Puede importar historia ajena.** Coexistence trae hasta 180 días de
  conversaciones que ocurrieron fuera de Resender, con un **deadline duro de
  24 h** para pedir el sync o la conexión se pierde.
- **Depende de aprobaciones de Meta** que no controlamos: Business
  Verification, Advanced Access, Access Verification como Tech Provider y App
  Live, más una elegibilidad de Coexistence que Meta no publica.

La versión anterior del PRD (11 de agosto) se escribió contra `apps/api` y
`packages/contracts`, que se borraron el 21 de agosto (ADR 0012), y contra
supuestos de plataforma que se verificaron falsos. La versión del 24 de agosto
la reemplaza y es la que esta ADR registra.

## Decisión

### El canal entero vive en `apps/web`

Rutas propias bajo `/api/meta/whatsapp/*` —webhook, `start`, `callback`, `send`
y `media/[id]`—, no un campo `channel` sobre las rutas de Messenger. Es el mismo
criterio de Instagram. No se resucita un segundo Worker: un tercer canal del
mismo producto es exactamente el espejo-a-mano que la ADR 0012 diagnosticó como
roto.

### Dos onboardings, un solo modelo de datos

Embedded Signup estándar para números nuevos o exclusivos de Cloud API, y
Embedded Signup de Business App para Coexistence. Comparten UI base y no
comparten el paso de registro: **un número de Coexistence no pasa por
`/register`**. Un número registrado por el flujo estándar deja de ser candidato
a Coexistence, así que probar los dos caminos exige dos números reales
distintos.

Cada número es una [Conexión] y ocupa un slot del plan, sin agrupar por WABA
(ADR 0011).

### Un solo botón, y el `onboarding_mode` derivado del evento de cierre

**Esto se desvía del PRD a sabiendas.** La sección «Embedded Signup y seguridad»
pide «botón separado para número nuevo y número existente, con copy distinto».
Hay un solo botón, «Conectar WhatsApp».

El motivo es un hallazgo empírico, verificado contra el diálogo real de Meta y
no leído en la documentación: **`extras.featureType =
"whatsapp_business_app_onboarding"` es aditivo, no restrictivo**. Con el
`featureType` puesto, el desplegable «Cuenta de WhatsApp Business» ofrece las
tres opciones —crear una cuenta de WhatsApp Business, «Conecta una aplicación de
WhatsApp Business» (Coexistence) y las WABAs que el portafolio ya tiene—. Sin
él, la segunda no aparece. Los dos flujos salen, entonces, con **las mismas
opciones de `FB.login` y el mismo Configuration ID**.

Con eso, dos botones dejan de ser una elección: son dos etiquetas para el mismo
diálogo. Y el precio de mantenerlos no era estético. El `onboarding_mode` se
persistía según **cuál se hubiera pulsado**, es decir, según una suposición
sobre algo que el usuario podía cambiar en la ventana siguiente. Ese campo
decide si se llama a `POST /{phone_number_id}/register`, que es irreversible y
desvincula el número de la app de WhatsApp Business: suponerlo mal es registrar
un número que el cliente quería seguir usando desde su teléfono.

Así que el modo **se deriva del evento de cierre**, que es la única fuente que
sabe qué eligió el usuario:

| evento de `WA_EMBEDDED_SIGNUP`            | modo                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `FINISH`                                  | `standard`                                                                |
| `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` | `coexistence`                                                             |
| `FINISH_ONLY_WABA`                        | terminó sin número; no se conecta nada                                    |
| cualquier otro `FINISH*`                  | variante no soportada; no se conecta nada, y **no se deriva ningún modo** |

Es un cambio de dirección, no una simplificación: antes el módulo **comparaba**
el evento contra el modo lanzado y rechazaba el cruzado —una red que existía
justamente porque el modo venía del botón—; ahora el evento **es** la fuente de
verdad. Por eso esto es más correcto que lo que pedía el PRD, no solo más
barato: el PRD daba por hecho que la elección se hacía antes del diálogo, y en
el diálogo real se hace adentro.

Consecuencias que arrastra, todas deliberadas:

- **El copy de las advertencias se mueve a después del cierre.** Antes del clic
  no se puede decir la consecuencia concreta sin confundir, porque todavía no
  está elegida: el botón dice que hay una elección y que no da lo mismo cuál, y
  la advertencia específica —el número deja de poder usarse desde la app, o el
  techo de 20 mps y el reloj de 24 h— se muestra al cerrarse la ventana, ya con
  el modo real.
- **`NEXT_PUBLIC_WHATSAPP_COEXISTENCE_CONFIG_ID` se borra.** Un solo
  Configuration ID sirve para los dos flujos, así que la variable quedaba muerta
  en `turbo.json` y en los tres workflows. Una env var declarada que no decide
  nada es peor que no tenerla: alguien la va a rellenar creyendo que hace algo.
- **`/api/meta/whatsapp/start` deja de aceptar `?mode=`**, y «Reconectar» deja
  de generarlo. Ese parámetro solo servía para resaltar uno de los dos botones.
- **La invariante tiene test propio, de punta a punta**: un cierre
  `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` recorre `postMessage` → modo
  derivado → cuerpo del POST → `runWhatsappSignup` y nunca llega a
  `registerWhatsappPhoneNumber`.

Riesgo que queda vivo: si Meta renombra el `featureType`, el diálogo deja de
ofrecer Coexistence y el usuario no puede conectar el número que ya usa. Degrada
el menú, no la decisión —el modo sigue saliendo del evento de cierre—, así que
el fallo es «no aparece la opción», no «registramos de más».

### La ventana de 24 h se aplica localmente y no hay plantillas

`conversations.last_inbound_at` se escribe en un solo módulo y solo cuando el
mensaje es entrante, vivo y del cliente final: no la abre un saliente, ni un
status, ni un mensaje importado, ni un echo de Business App. Con la ventana
cerrada la API responde `409 customer_service_window_closed` con
`templateSendingSupported: false` **sin llamar a Meta**.

Se eligió estado materializado sobre consulta en vivo porque el Inbox necesita
el estado de ventana por conversación en una lista, y pintar 50 conversaciones
serían 50 lateral joins.

### R2 privado, solo para media entrante, con retención de 180 días

Bucket privado por ambiente, keys con el tenant primero (`wa/{tenantId}/...`),
ownership en Postgres y no en el bucket, descarga por una ruta autenticada que
acepta API key o sesión y soporta `Range`. Sin URLs prefirmadas: el binding de
R2 no las firma y una URL filtrada es acceso anónimo al archivo.

La retención de 180 días es una **lifecycle rule del bucket**, cero código de
borrado, y el estado que ve la UI se deriva de la edad de la fila para que no
pueda desincronizarse. Sin ese techo el costo no está acotado por nada: la cuota
del plan mide eventos, no bytes.

**La media saliente no se hospeda.** El cliente entrega una URL pública `https`
y Meta la descarga, igual que en Messenger. Con eso R2 queda solo para entrada y
desaparecen los tres endpoints de upload que proponía la versión anterior.

### El canal nace apagado, por cuenta

`users.whatsapp_enabled`, copia exacta del patrón de Instagram (ADR 0010):
fail-closed, leído vivo contra la base, **sin backfill**. La 0015 sí backfilleó
porque Instagram ya funcionaba para esas cuentas; WhatsApp no funcionaba para
nadie, así que habilitar a todos sería regalar acceso a un canal que nunca
tuvieron.

### Cola propia y trabajo asíncrono

`whatsapp-jobs` con DLQ, separada de `webhook-deliveries`: un import de historial
son miles de jobs que en la cola de entregas competirían en batches de 10 con
los pushes de todos los tenants. El cron de 5 minutos ya existente reclama los
vencidos, incluido el `history_sync_request` no confirmado antes del deadline.

### El historial no cobra; los echoes sí

Un mensaje importado por Coexistence (`historical=true`) no consume cuota y no
se reenvía al webhook externo: cobrar por algo que decidimos no entregar no se
puede defender, y sin la excepción un Starter podría quedarse sin cuota el mismo
día que conecta. Un echo de Business App es tráfico vivo, se reenvía y **sí**
consume cuota.

### El PIN de `/register` se guarda cifrado

Esto **no está en el PRD**. No es una contradicción con él: el PRD mantiene
`/register` en el flujo estándar, así que el problema existe y quedó sin cubrir.
Se cubre acá.

Registrar un número en Cloud API exige un PIN de verificación en dos pasos, y
hay dos casos. Si el número ya tenía la 2FA activada, el PIN lo aporta el
cliente. Si no la tenía, **el PIN que mandamos la está creando**: le activamos
verificación en dos pasos a un número que no la pedía.

Ese segundo caso obliga a guardarlo. Meta no lo vuelve a mostrar y no hay
endpoint para leerlo, así que no guardarlo deja al cliente con la 2FA activada
sobre su propio número y un PIN que no conoce nadie —ni para re-registrarlo acá
ni en ninguna otra plataforma—. Y rompe nuestra propia reconexión: al relanzar
el Embedded Signup sobre un número ya registrado, `/register` vuelve a pedir el
PIN vigente, y sin la columna la segunda conexión falla siempre con **133005**
pidiéndole al cliente un PIN que inventamos nosotros.

De ahí `connected_pages.whatsapp_pin_encrypted` y
`connected_pages.whatsapp_pin_generated`, cifrado con el mismo aes-256-gcm y la
misma `TOKEN_ENCRYPTION_KEY` que los tokens de página. La segunda columna dice
**de quién** es el PIN, porque cifrados los dos casos se ven igual y solo el
nuestro hay que poder enseñárselo al cliente; `null` significa «no consta» y se
trata como «no lo enseñes». Es dato del cliente que custodiamos, no un secreto
nuestro.

### `sessionInfoVersion` queda sin resolver

El PRD pide `sessionInfoVersion` vigente en la configuración del Embedded
Signup. Una implementación anterior lo **omitió a propósito**, con dos
argumentos: que el parámetro pertenece a Embedded Signup v2, y que Meta lo
deprecia el **15 de octubre de 2026**.

No se decide acá cuál de las dos posturas es la correcta, porque las dos son
afirmaciones sobre la documentación de Meta y ninguna se verificó contra ella al
escribir esto. **Queda registrado como pendiente explícito: hay que comprobarlo
contra la documentación viva de Meta antes de correr el primer onboarding real**,
y dejar escrita la fecha de esa verificación como se hizo con la tabla de hechos
de plataforma. Un Embedded Signup mal configurado no falla en desarrollo con
assets propios: falla el día del primer cliente.

## Consecuencias

### Elegibilidad de Coexistence: el criterio que no depende de nosotros

Meta habilita Coexistence por región y **no publica una lista consolidada** de
códigos de país; la última expansión documentada en el changelog es India. No
está verificado que el número de prueba sea elegible, y no se verifica leyendo
documentación: hay que mirarlo en el App Dashboard.

Además, el requisito «must already be a Solution Partner or Tech Provider» es
ambiguo: puede significar «estás construyendo como Tech Provider» o «ya pasaste
Access Verification». Si es lo segundo, Coexistence queda detrás del mismo gate
que el rollout público.

Consecuencia declarada: **es el único criterio de aceptación de la fase cuya
evidencia depende de una decisión de Meta.** Si el número resulta inelegible, la
fase se entrega diciendo explícitamente qué quedó sin evidencia end-to-end, en
vez de darlo por probado. La UI muestra un error accionable y ofrece el
onboarding estándar, sin prometer migración automática.

### Deuda declarada

Elegida a sabiendas, no descubierta. Las once del PRD, más las dos que el PRD no
tiene:

1. **Elegibilidad de Coexistence fuera de nuestro control.** Si el número
   resulta inelegible, ese criterio de aceptación se entrega sin evidencia
   end-to-end y se declara.
2. **Cardinalidad 1 en el esquema de adjuntos.** Un mensaje de Cloud API tiene
   exactamente un `type`. El día que un canal traiga dos, hay que migrar a
   tabla.
3. **«Adjunto» pasa a significar «todo lo que no es texto».** La entrada
   [Adjunto] de `CONTEXT.md` dice «archivo o tarjeta» y hay que corregirla.
4. **Media saliente por `link`:** Meta cachea 10 minutos y el archivo lo hospeda
   el cliente. Un origen caído en el instante del envío falla el mensaje.
5. **`last_inbound_at` es estado derivado.** Un parser nuevo que olvide
   escribirlo deja la conversación muda; por eso la escritura vive en un solo
   módulo.
6. **Dos índices únicos parciales parecidos** sobre las mismas dos columnas. Hay
   que leer los dos para entender la regla completa.
7. **180 días es un número elegido**, no derivado de una medición.
8. **El uuid del tenant sobrevive al borrado** de la cuenta hasta que R2
   confirma la purga, y nunca más de 180 días. Declarado en `/privacy` con esas
   palabras, no escondido.
9. **El backfill de la `0015` deja de ser regla general.** Se hizo porque
   Instagram ya funcionaba para esas cuentas; la `0017` no lo hace porque
   WhatsApp no funcionaba para nadie.
10. **Cinco estados de adjunto** (`pending`, `available`, `failed`, `deleted`,
    `unavailable`). La UI tiene cinco ramas.
11. **El día del Advanced Access hay que correr un `update` a mano.** No hay
    pantalla que lo recuerde.
12. **El PIN de `/register` se custodia y el PRD no lo menciona.** Guardamos un
    secreto del cliente que además, en el caso `whatsapp_pin_generated = true`,
    creamos nosotros activándole una 2FA que no pidió. Hay que poder
    devolvérselo, y su pérdida —una rotación de `TOKEN_ENCRYPTION_KEY` sin
    re-cifrado, por ejemplo— deja al cliente sin poder re-registrar su propio
    número en ninguna parte.
13. **`sessionInfoVersion` está sin resolver.** El PRD lo pide, una
    implementación anterior lo omitió argumentando v2 y deprecación el 15 de
    octubre de 2026, y nadie lo verificó contra la documentación viva de Meta.
    Hay que hacerlo antes del primer onboarding real.

### Lo demás que hay que asumir

- **Aparece una dependencia de almacenamiento.** Cloudflare R2 entra como
  sub-procesador y hay que nombrarlo en `/privacy` junto con Cloudflare Workers
  y Neon, y sacar de ahí la referencia obsoleta a Vercel.
- **El producto ya no es «Messenger».** `/privacy`, `/terms`, `/data-deletion` y
  la documentación pública tuvieron que dejar de describir un producto de un
  solo canal.
- **El borrado de cuenta deja de ser puramente transaccional.** Sigue siendo un
  `delete` inmediato, pero la limpieza de bytes es un job reanudable con cursor
  y confirmación separada, con la lifecycle rule de 180 días como red.
- **Un número en Coexistence tiene techo fijo de 20 mensajes/segundo** y no
  escala por messaging tier. Hay que documentarlo antes de venderlo.
- **La infraestructura de WhatsApp se crea a mano** —dos buckets, cuatro colas,
  dos lifecycle rules— y está en `docs/api-cloudflare-manual-runbook.md`.
  Staging tiene bucket y colas propios: compartirlos haría que un job de prueba
  tocara los archivos de un cliente que paga.
- **El bundle se acerca al techo.** El canal entero entra en el Worker que medía
  5,82 de 8 MB al empezar la fase. Si lo cruza, el corte es sacar marketing y
  blog, no sacar la API de Next (ADR 0012).

## Cuándo revisar esta decisión

1. **Cuando Meta apruebe Advanced Access y Access Verification.** Ese día
   `whatsapp_enabled` deja de ser un gate de lanzamiento y pasa a ser código
   muerto, como `waitlisted` después de la 0011.
2. **Cuando haga falta iniciar conversaciones.** Las plantillas son la fase
   siguiente y rompen tres supuestos de esta: que el usuario final escribe
   primero, que la ventana de 24 h es la única regla de envío, y que no
   administramos assets de mensajería en Meta. No se acomodan como un tipo de
   mensaje más.
3. **Cuando un canal traiga más de un adjunto por mensaje.** Ahí cae la
   cardinalidad 1 y hay que migrar a tabla.
4. **Cuando la retención de 180 días le moleste a alguien que paga.** Hoy es
   fija para todos los planes; volverla configurable convierte una lifecycle
   rule en código de borrado con estado por tenant.
5. **Cuando el volumen de media haga visible el costo de R2.** El número se
   eligió sin medir; con datos reales se revisa con datos reales.
6. **Cuando aparezca un canal que no sea de Meta.** Tres canales comparten hoy
   `provider = "meta"`, el mismo App Secret y la misma firma de webhook. El
   cuarto que no lo comparta rompe esa simetría, no este canal.
