---
status: accepted
---

# Instagram entra a facturación: el cupo se mide en cuentas y los mensajes cuentan

La ADR 0008 dejó Instagram **fuera de cuota y fuera del cupo de páginas**, y anotó la razón:
era una decisión de negocio provisional porque los planes publicados hablaban de «páginas de
Facebook». El punto exacto donde volvía el entitlement quedó marcado con un comentario en cada
ruta de envío.

Esta ADR toma la decisión que aquella dejó pendiente, y la toma en la dirección contraria:
**Instagram se comporta exactamente igual que Messenger**. No hay ningún canal con trato
especial, y por eso la implementación es sobre todo código **eliminado** —una constante
`CHANNEL_IS_METERED`, un `periodStart: null` forzado, tres comentarios que decían «acá no va el
gate»— y no una segunda excepción con el signo cambiado.

## Considered Options

- **Un cupo separado para Instagram** (por ejemplo 2 Páginas *más* 2 cuentas de IG) — rechazado.
  Duplica el número que el usuario tiene que entender y obliga a dos contadores en la UI, dos
  códigos de bloqueo y dos aritméticas en el entitlement, para un producto que ya trata a los
  dos canales como «cuentas conectadas» en todas sus pantallas.
- **Un bucket de cuota separado para Instagram** — rechazado por lo mismo, y peor: sería un
  segundo `period_start`, un segundo estado de bloqueo y un entitlement paralelo entero, sin
  ninguna razón de producto que lo pida. El precio dice «por mensaje procesado», no «por
  mensaje de Messenger».
- **Cupo unificado por cuenta conectada** — elegido. Starter 2, Pro 5, en cualquier
  combinación: 2 Páginas, 2 cuentas de IG, 1 y 1. Ni los precios ni los límites de mensajes
  cambian de valor; cambia **qué** cuenta el número que ya existía.
- **Dejar los comentarios gratis y cobrar solo DMs** — rechazado. Una respuesta pública cuesta
  la misma llamada a Graph y persiste la misma fila que un DM; regalarla rompe «1 unidad = 1
  operación del relay», que es lo que hace que el precio se pueda explicar en una frase. Y deja
  un hueco real: un tenant con mucho volumen de comentarios no pagaría por ese uso.

## Decisiones de dominio

- **El cupo se mide en cuentas conectadas `active`, de cualquier canal.** `countActiveAccounts`
  perdió su `and channel = 'messenger'` en los dos workers. Los límites siguen en 2 y 5.
- **`getPageOwnership` conserva su filtro `channel = 'messenger'`, y no es una
  inconsistencia.** Son dos preguntas distintas: una cuenta slots del plan, la otra busca *ids
  de Página de Facebook*, donde desde la migración 0013 una cuenta de IG homónima es legítima y
  haría que una Página se muestre como «ya pertenece a otra cuenta». La asimetría está fijada
  por `apps/web/lib/pages/page-registry.test.ts`, porque un comentario no falla cuando alguien
  «arregla» la diferencia.
- **Las tres superficies de Instagram cuentan.** Un comentario entrante persistido suma 1, una
  respuesta pública aceptada por Meta suma 1 y una respuesta privada aceptada suma 1.
  **Consecuencia explícita: un comentario contestado en público y en privado consume 3
  unidades.** Es deliberado — son tres operaciones de Graph y tres filas persistidas.
- **`countsTowardQuota` no se extendió.** Su unión sigue siendo `inbound | reply`: el predicado
  contesta «dado el resultado de una operación, ¿se factura?», y esas dos respuestas ya son
  toda la verdad. Agregar `comment_inbound | comment_reply | private_reply` daría cinco ramas
  con cuerpos idénticos, y la función pasaría a codificar *en qué superficie* ocurrió en vez de
  *qué pasó*. Que la pública y la privada del mismo comentario sumen 1 cada una no es una
  propiedad del predicado, sino de que hay dos call sites.
- **Paridad también en el bloqueo.** Con la cuota agotada o el cupo excedido, las tres rutas de
  Instagram devuelven 402/403 y sus entrantes dejan de reenviarse al `webhookUrl` del tenant.
  La ingesta de comentarios de `apps/web` pasó a aplicar `shouldPushInbound`, que hasta ahora
  solo distinguía «hay webhookUrl» de «no hay».
- **El gate de cuota va después del replay idempotente, no dentro del helper compartido.** Era
  la trampa del cambio: `authenticateCommentReplyRequest` es el módulo de lo compartido y su
  comentario decía literalmente «este es el punto donde vuelve», pero las dos rutas resuelven
  su replay *después* de llamarlo. Metido ahí, un 402 caería sobre un replay y le diría al
  cliente que falló un mensaje que Meta ya entregó, justo en la tormenta de reintentos que la
  `Idempotency-Key` existe para hacer segura. Por eso hay una función aparte,
  `assertCommentReplyEntitlement`: una implementación, dos call sites, orden preservado.
- **El gate de cupo de la conexión de Instagram vive en dos sitios, con trabajos distintos.**
  El autoritativo está en el callback, después del perfil —necesita el IG ID para distinguir
  una re-autorización de una cuenta nueva— y antes de la suscripción, para no dejarle a Meta
  una suscripción colgando de una cuenta que después rechazamos. El de `/start` es anticipado y
  **exacto, no heurístico**: solo bloquea cuando el tenant no tiene ninguna cuenta de IG
  activa, porque ahí el OAuth únicamente puede terminar en cuenta nueva.
- **Re-autorizar una cuenta ya activa no consume un slot nuevo.** El token de Instagram vence a
  los ~60 días, así que reconectar es mantenimiento rutinario: cobrarle un slot dejaría varado
  sin salida a quien esté justo en el tope, que no podría renovar el token de una cuenta que ya
  tiene. Reconectar una cuenta `disconnected` sí cuesta cupo, igual que en Facebook.
- **El código de error sigue llamándose `page_limit_exceeded`.** Es contrato de cable público
  (ADR 0003) y renombrarlo rompería a cualquier cliente que parsee `error`. Queda como deuda
  anotada: el nombre dice «page» y el límite ya no cuenta páginas.
- **Se implementa en los dos workers en la misma entrega**, siguiendo el precedente de la 0008.

## Consequences

- **El cupo cambia de significado sin migración, y ese es el riesgo principal.**
  `countActiveAccounts` es una consulta, no un valor guardado: en el instante en que el worker
  deploya sin el filtro, el `activeAccountCount` de cada tenant sube por su número de cuentas
  de IG activas. Un tenant Starter con 2 Páginas + 1 cuenta de IG pasa a 3 > 2 y queda en
  `page_limit_exceeded` **inmediatamente**, sin haber hecho nada.
- **Y `page_limit_exceeded` bloquea al tenant entero, por los dos canales.** Con el cupo
  unificado, conectar una cuenta de Instagram de más ahora **mata en silencio el tráfico de
  Messenger** de ese tenant. Esa interacción no existía antes: Instagram no podía empujar a
  nadie por encima del límite. El gate de la conexión es lo que lo previene, y por eso no es
  pulido de UX sino la mitigación del peor modo de falla de este cambio.
- **Mitigación antes de desplegar:** medir cuántos tenants quedarían por encima del cupo
  (consulta en el runbook). Si el conjunto es chico, avisarles y moverlos de plan en Stripe
  **antes** del deploy —grandfatherear por plan y no por código, para no dejar una rama legacy
  que viviría para siempre—. Solo si fueran demasiados para tratarlos a mano valdría una
  columna de override por tenant leída junto a la suscripción; **no** un feature flag en
  `countActiveAccounts`, que sería una segunda fuente de verdad del entitlement y obligaría a
  los dos workers a ponerse de acuerdo sobre ella.
- **El rollback es asimétrico.** Revertir el cupo es limpio: vuelve el filtro y los conteos
  bajan. Revertir la medición no lo es: las unidades ya cargadas en `usage_counters` no se
  descargan solas y el período afectado necesitaría una corrección manual. Por eso la partición
  recomendada es medición primero —aditiva, nada empieza a fallar salvo por agotamiento real— y
  cupo unificado después, que es donde algo empieza a devolver 403.
- **`insertOutboundComment` dejó de ser un `insert` pelado** y pasó al patrón CTE de
  `completeOutbound`. `ingestInboundComment` ganó su `usage_increment`. Los dos están cubiertos
  por aserciones de SQL en `repository.test.ts`, porque el fake DB de los tests de runtime
  emula esos CTEs **por índice posicional** de binding: sin esas aserciones, borrar el CTE
  dejaría al helper sumando igual y el test pasaría mintiendo.
- **El copy de precios cambió en los dos idiomas**, incluidos los blobs de datos estructurados
  y de `llms.txt`, que son los que se sirven a buscadores y modelos y son fáciles de olvidar.
