---
status: accepted
---

# El costo de Meta en WhatsApp se informa, no se cobra

Fecha: 2026-09-25. Decisión del issue #168. No cambia la cuota de la
[ADR 0003](0003-plan-entitlements-usage-quota.md) ni el plan Free de la
[ADR 0022](0022-plan-free-derivado.md).

## Contexto

Desde el **1 de octubre de 2026** Meta cobra los mensajes de servicio, las respuestas libres
dentro de la ventana de 24 h, que hasta ahora eran gratis:

- Cada número de negocio tiene **1.000 mensajes de servicio gratis al mes**. Después Meta cobra
  cada mensaje entregado con la tarifa del país del destinatario, sin descuento por volumen.
- Las plantillas de utilidad dentro de la ventana también dejan de ser gratis.
- La WABA necesita un **método de pago** antes del 30 de septiembre de 2026. Sin él, Meta puede
  dejar de entregar las respuestas (error `131042`).
- Los mensajes que entran siguen sin costo.

Resender solo envía mensajes libres dentro de la ventana de 24 h, así que el cambio alcanza todo
el tráfico saliente de WhatsApp de los clientes. Hoy nada en el producto dice que Meta cobra.

## Considered Options

- **Revender el costo de Meta** (Resender paga a Meta y se lo factura al cliente, con o sin
  margen): rechazada. Nos haría responsables de la línea de crédito de cada WABA, de tarifas
  por país que cambian sin aviso y del riesgo de cobro. Contradice el modelo de precio por
  [Mensaje contabilizado], que es el mismo en todos los canales.
- **Subir el precio de los planes para absorberlo**: rechazada. El costo depende del país del
  destinatario y del volumen de cada número; un precio plano subsidia a unos con otros.
- **No decir nada y dejar que el cliente se entere por Meta**: rechazada. El primer síntoma
  sería un `131042` con mensajes sin entregar, y el cliente culparía al relay.

## Decisión

- **Cada cliente le paga a Meta con su propia tarjeta**, registrada en su WABA. Meta le factura
  directo. Resender no cobra ese cargo, no lo revende y no le pone margen.
- **Resender informa.** La página de precios, las preguntas frecuentes, los Términos y el alta de
  WhatsApp dicen que Meta cobra aparte y enlazan a sus tarifas y a la configuración de pagos de
  Meta Business. Los enlaces viven en `lib/meta/whatsapp-billing-links.ts`.
- **El error `131042` dice qué hacer**: agregar o corregir el método de pago en la WABA, con el
  enlace. En la API va en el `message`; en la bitácora (`/logs`) sale además un aviso traducido.
- **La cuota del plan no cambia** y es independiente del cobro de Meta: una respuesta de
  WhatsApp sigue sumando 1 [Mensaje contabilizado], la cobre Meta o no.
- **Los conteos que muestre Resender son informativos.** La factura de Meta es la única fuente
  de lo que el cliente le debe a Meta. Queda en los Términos.

## Consequences

- Hay dos contadores con nombres parecidos y hay que mantenerlos separados en la UI y en el
  código: [Mensaje contabilizado] (la cuota de Resender) y [Mensaje cobrado por Meta].
- Guardar el dato de cobro que manda Meta en cada acuse (#170) y mostrarle al cliente su consumo
  del cupo gratis (#171) son trabajo aparte, sobre esta misma decisión.
- Tarifas por país y estimación del costo en dinero quedan fuera: se puede evaluar después.
- El cupo de 1.000 gratis lo publican varios proveedores pero la página de precios de Meta
  todavía no lo menciona. Si Meta publica otro número, se corrige el copy.
