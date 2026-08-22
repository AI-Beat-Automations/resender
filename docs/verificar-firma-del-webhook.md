# Verificar la firma del webhook

Cada POST que Resender manda al webhook de una conexión lleva tres cabeceras:

| Cabecera | Ejemplo | Qué es |
| --- | --- | --- |
| `resender-event-id` | `evt_0189a1b2c3d44e5f8a9b0c1d2e3f4a5b` | Id del evento. Estable: el mismo evento reingerido trae el mismo id. |
| `resender-timestamp` | `1767225600` | Epoch en **segundos** del momento de la firma. |
| `resender-signature` | `v1=9f86d081…` | `v1=` + HMAC-SHA256 en hex. |

El secreto se genera al guardar por primera vez la Webhook URL y **se muestra una
sola vez**. Empieza con `whsec_`. Si no lo copiaste, rotalo desde **Connections** —
eso invalida el anterior.

## Qué se firma

```
HMAC-SHA256(secreto, "<resender-event-id>.<resender-timestamp>.<cuerpo crudo>")
```

Los tres campos separados por punto, en ese orden. **El cuerpo tiene que ser el
texto crudo del request**, no el resultado de parsear y volver a serializar el
JSON: `JSON.stringify(JSON.parse(body))` puede reordenar claves o cambiar el
escapado, y la firma deja de coincidir.

No se firma solo el cuerpo, y es a propósito:

- Sin el **event id**, una firma válida sirve para reenviar otro cuerpo idéntico
  como si fuera un evento nuevo.
- Sin el **timestamp**, una firma capturada vale para siempre.

## Cómo verificar

```js
import { createHmac, timingSafeEqual } from "node:crypto"

const TOLERANCE_SECONDS = 300

export function verify({ secret, rawBody, headers }) {
  const eventId = headers["resender-event-id"]
  const timestamp = Number(headers["resender-timestamp"])
  const signature = headers["resender-signature"]
  if (!eventId || !signature || !Number.isFinite(timestamp)) return false

  // 1. Ventana de tolerancia. Sin esto, la firma no caduca nunca y un POST
  //    capturado se puede reproducir mañana.
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp)
  if (age > TOLERANCE_SECONDS) return false

  // 2. La firma esperada, sobre el cuerpo CRUDO.
  const expected =
    "v1=" +
    createHmac("sha256", secret)
      .update(`${eventId}.${timestamp}.${rawBody}`)
      .digest("hex")

  // 3. Comparación en tiempo constante. Un `===` sobre el hex filtra, por lo que
  //    tarda en fallar, cuántos caracteres del principio acertó quien prueba.
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

## En n8n

El nodo **Webhook** tiene que estar en modo *raw body* para que el cuerpo llegue
sin reserializar. Después, un nodo **Code** con la función de arriba, leyendo el
secreto desde credenciales y **no** desde el workflow en claro.

## Deduplicación

`resender-event-id` es estable por evento. Guardá los ids ya procesados y
descartá los repetidos: Resender reintenta hasta cinco veces ante fallos
transitorios (5xx, 408, 429, timeouts y errores de red), así que un endpoint que
responde 500 después de haber hecho su trabajo va a recibir el mismo evento otra
vez.

Un `2xx` cierra la entrega. Un `4xx` que no sea 408 ni 429 se considera
definitivo y **no** se reintenta.

## Conexiones sin firma

Una conexión creada antes de que existiera la firma no tiene secreto y su push
sale **sin las tres cabeceras**. Seguí entregándole igual — el cambio es aditivo —
y cuando quieras activarla, entrá a **Connections** y pulsá `Generar`.
