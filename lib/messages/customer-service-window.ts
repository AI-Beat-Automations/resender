// La ventana de atención al cliente de WhatsApp, resuelta en local.
//
// Meta acepta mensajes de forma libre sólo mientras el contacto haya escrito en
// las últimas 24 horas. Fuera de eso el único camino es una plantilla aprobada,
// que este producto todavía no vende. Comprobarlo acá —y no dejar que lo diga
// Meta con un 131047— convierte un rechazo remoto y ambiguo en un 409 nuestro
// que nombra la causa, y ahorra la llamada entera.
//
// **Por qué la fuente es una columna materializada y no una consulta viva.**
// `conversations.last_inbound_at` guarda el instante del último entrante real
// del cliente. La alternativa sería preguntarle a `messages` por el máximo
// `created_at` entrante de cada conversación en el momento de leer, y ahí está
// el problema: el Inbox no pinta una conversación, pinta una LISTA. Pintar 50
// conversaciones con estado de ventana serían 50 lateral joins contra la tabla
// más grande del esquema en cada scroll. Con la columna es una lectura más de
// la misma fila que ya se trae.
//
// **Este módulo no decide qué mensaje abre la ventana.** Esa regla vive en un
// único lugar —`opensCustomerServiceWindow`, en `message-log.ts`— y sólo mueve
// la columna cuando el mensaje es `direction='inbound'` y `historical=false` y
// `origin='customer'`. Un import de historial de Coexistence, un saliente
// nuestro, un callback de estado y el eco de lo que el negocio tecleó en la
// WhatsApp Business App fallan a propósito en abrirla. Recalcular acá esa regla
// sería tener dos definiciones de "nos escribió" que se desincronizan solas:
// acá sólo se consume la columna.

export const CUSTOMER_SERVICE_WINDOW_HOURS = 24

const WINDOW_MS = CUSTOMER_SERVICE_WINDOW_HOURS * 60 * 60 * 1000

/**
 * Si la ventana de 24 horas sigue abierta.
 *
 * Abierta si y sólo si hay un entrante registrado y pasó **menos** de la
 * ventana desde entonces. El borde es exclusivo: a las 24:00:00 exactas ya está
 * cerrada, que es como lo cuenta Meta —y elegir el borde inclusivo nos dejaría
 * mandando un mensaje que Cloud API rechaza justo en el segundo del corte.
 *
 * `null` es cerrada, y no "desconocida": una conversación sin entrante nunca
 * tuvo ventana. Es el caso del primer contacto, donde el negocio quiere
 * escribir primero y no puede.
 *
 * Puro y con `now` inyectado: la ventana es aritmética de fechas y no tiene por
 * qué depender del reloj del proceso para poder testearse en el borde.
 */
export function isWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  if (!lastInboundAt) return false
  // Sin recortar la resta por abajo a propósito: un `last_inbound_at` en el
  // futuro (desfase de reloj entre Meta y nosotros) da negativo y cuenta como
  // abierta. Es la lectura conservadora del lado del cliente —dejamos que Meta,
  // que es la autoridad final, rechace si tiene que rechazar— en vez de negar
  // un envío por unos milisegundos de deriva.
  return now.getTime() - lastInboundAt.getTime() < WINDOW_MS
}
