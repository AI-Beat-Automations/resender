---
status: accepted
---

# Entitlements por plan: cuota mensual de mensajes y límite de páginas

El ADR 0002 dejó el entitlement **binario** (suscripción activa sí/no) y la diferenciación
funcional entre planes explícitamente sin definir. Este ADR la define: cada plan pasa a tener
una **cuota mensual de mensajes** y un **límite de páginas conectadas**, que se aplican en el
hot path de la API y del webhook entrante.

La landing ya vendía estos números (`content/i18n/es.ts`) sin que existiera nada que los
aplicara: cualquier tenant con suscripción activa tenía uso ilimitado. Este ADR cierra esa
brecha entre lo que se cobra y lo que se entrega.

## Planes

| Plan | Precio | Mensajes / período | Páginas |
|---|---|---|---|
| `starter_monthly` | $15 | 50.000 | 2 |
| `pro_monthly` | $25 | 100.000 | 5 |

**`business_monthly` ($60) se elimina.** Su price ya fue archivado en Stripe y no existe
ninguna suscripción en ese plan, así que la baja es limpia: se quita la entrada de
`PLAN_LOOKUP_KEYS` y `PLANS` en `lib/billing/plans.ts`. Esto contradice el ADR 0002 y
`CONTEXT.md`, que hablaban de tres planes; ambos quedan enmendados por este documento.

## Considered Options

- **Derivar el consumo de la tabla `messages` con `count(*)`** — rechazado. Es la fuente de
  verdad natural y no requiere migración ni riesgo de desincronización, pero pone un index
  scan de hasta 100.000 filas en **cada** envío y **cada** mensaje entrante. A volumen de plan
  Pro el hot path se degrada de forma proporcional al éxito del cliente.
- **Contador denormalizado por (tenant, período)** — elegido. Un solo statement atómico
  (`insert ... on conflict do update set count = count + 1 returning count`), que es lo único
  disponible: el driver HTTP de Neon **no soporta transacciones interactivas** (ya documentado
  en `lib/pages/page-registry.ts`). `messages` queda como bitácora de auditoría para reconciliar.
- **Mes calendario UTC como ventana** — rechazado. Es más simple y no depende de datos
  replicados por webhook, pero le regala una cuota completa a quien paga el día 28.
- **`429 Too Many Requests` para cuota agotada** — rechazado. `429` comunica velocidad; esto
  es cuota comprada, y el cliente que la recibe debe entender que se arregla pagando, no
  reintentando más lento.

## Decisiones de dominio (fijadas en la entrevista)

- **Qué cuenta como mensaje**: cuentan **ambas direcciones**. Un mensaje entrante persistido
  suma 1; una respuesta que Meta acepta (`status: 'sent'`) suma 1. Por lo tanto una conversación
  de ida y vuelta consume 2 unidades, y los 50.000 del Starter son ~25.000 intercambios. Los
  números publicados **se mantienen** aun sabiendo esto; es una decisión consciente, no un
  descuido de conversión.
  **Ampliado por la ADR 0010**: «mensaje entrante» incluye el comentario de Instagram, y
  «respuesta» incluye la respuesta pública a un comentario y la respuesta privada. Las cinco
  superficies —DM de Messenger, DM de Instagram, comentario entrante, respuesta pública,
  respuesta privada— se miden con la misma regla.
- **Qué NO cuenta**: un envío que Meta rechaza (`status: 'failed'`) no consume cuota — el
  cliente no debe pagar por un page token vencido nuestro ni por la ventana de 24h de Messenger.
  Un replay idempotente tampoco: no llama a Meta ni inserta mensaje nuevo.
- **Los entrantes cuentan aunque no se entreguen.** Si el tenant está restringido, o si la
  página no tiene `webhookUrl` configurada, el mensaje se persiste igual y consume cuota. El
  costo que la cuota cubre es el de recibir y persistir, no el de entregar.
- **Ventana = período de facturación de Stripe**, no mes calendario. El contador se resetea
  cuando cierra el ciclo que el cliente pagó. Requiere persistir `current_period_start`, que
  hoy no existe en la tabla `subscriptions` (migración `0005` solo guarda `current_period_end`).
- **Fail-closed sin período conocido**: si `current_period_start` falta o es nulo, no hay envío.
  Mismo criterio que el resto de los gates del sistema (`hasActiveSubscription`, waitlist).
- **Upgrade inmediato, downgrade diferido.** El upgrade se aplica en el acto: sube el techo y
  **conserva el consumo** (quien gastó 50.000 y sube a Pro tiene 50.000 restantes, no 100.000).
  Así ciclar planes no resetea cuota. El downgrade se agenda al cierre del período: quien pagó
  el mes lo usa completo, mismo criterio que `cancel_at_period_end`.
- **Cuenta restringida**: estado degradado único con dos causas —cuota agotada y exceso de
  páginas tras un downgrade—. En ambos casos los entrantes **se siguen persistiendo**, dejan de
  reenviarse al webhook del cliente, y el envío queda bloqueado **para todas las páginas** del
  tenant, no solo las excedentes. Se levanta solo cuando se resuelve la causa (nuevo período de
  facturación, o el usuario desconecta páginas hasta quedar dentro de su límite).
- **Contrato de error**: dos códigos distintos, porque la acción del cliente es distinta.
  - `402 Payment Required` + `quota_exceeded` — se arregla subiendo de plan.
  - `403 Forbidden` + `page_limit_exceeded` — se arregla desconectando páginas.

  Cada uno con `message` legible explicando qué hacer. Se suman al contrato de errores
  `snake_case` definido en `prd_api_separation.md`.
- **El límite es un tope práctico, no exacto.** Como solo cuentan los envíos que Meta acepta,
  el orden obligado es llamar a Meta y después incrementar; sin transacciones interactivas, un
  puñado de requests concurrentes puede pasarse por decenas de mensajes. Aceptado.
- **Aviso al 80%**: barra de alerta **global en el dashboard** (no solo en `/connections`: quien
  no entra a esa pantalla no se entera). Sin email transaccional en esta entrega — no existe
  canal de correo en el repo.
- **Sin grandfathering.** No hay usuarios pagando todavía y el App Review ya está aprobado, así
  que el límite aplica parejo desde el día uno.

## Consequences

- Migración nueva: tabla de contadores por `(tenant_id, period_start)` y
  `subscriptions.current_period_start`, que debe empezar a poblarse desde el webhook de Stripe.
- El hot path suma lecturas: `POST /api/meta/send` y la ingesta del webhook de Meta pasan a
  resolver plan, período y consumo antes de actuar.
- `lib/billing/plans.ts` incorpora el mapa de límites por `price_lookup_key`. Un
  `price_lookup_key` desconocido debe tratarse fail-closed, igual que un período desconocido.
- **[INFRA]** El Customer Portal de Stripe debe configurarse para **diferir** los cambios de
  plan al cierre del período; por defecto Stripe los aplica inmediato con prorrateo, lo que
  rompería la regla de downgrade diferido.
- **[INFRA]** `business_monthly` archivado en Stripe (hecho).
- La copy pública queda desalineada: la FAQ promete *"Te avisamos cuando te acercás al límite"*
  (`content/i18n/es.ts`) dos veces, y un cliente lo lee como email. Hay que reescribirla para
  que apunte al dashboard mientras no exista correo transaccional.
- El ADR 0002 queda enmendado en dos puntos: ya no hay tres planes, y el entitlement ya no es
  binario.
