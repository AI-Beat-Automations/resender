// Monotonía del `delivery_status` que reporta WhatsApp (migración 0017).
//
// Meta entrega los callbacks de estado **fuera de orden**: el `read` puede
// llegar antes que el `delivered` del mismo wamid, y un reintento de un
// callback viejo puede aterrizar minutos después. Sin esta regla, un `sent`
// atrasado le borra el «leído» a un mensaje que el cliente ya leyó, que es el
// bug que el usuario reporta como «la palomita se fue para atrás».
//
// Módulo puro —sin DB, sin React— y no un `if` dentro del handler del webhook:
// los tests de esta app no corren `.tsx` y el handler es difícil de aislar, así
// que la regla escrita ahí dentro sería una regla sin red.

// La unión y el catálogo viven en `message-enums.ts`, con el resto de los enums
// de la fila. Se re-exportan acá porque este módulo es el que los consume de
// verdad y quien importa `outranks` casi siempre necesita el tipo al lado.
export { DELIVERY_STATUSES, type DeliveryStatus } from "./message-enums"

import type { DeliveryStatus } from "./message-enums"

// El progreso normal de un mensaje, y **solo** ese. `failed` no está en la
// escala a propósito: no es el paso siguiente a `read`, es la otra rama
// terminal. Meterlo en el ranking sería decir que un mensaje leído todavía
// puede fallar, y eso no pasa nunca.
const RANK: Record<Exclude<DeliveryStatus, "failed">, number> = {
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  deleted: 5,
}

/**
 * Si `next` puede pisar a `prev`. `prev === null` es el mensaje que todavía no
 * recibió ningún callback: cualquier estado es un avance.
 *
 * Las tres ramas que no son ranking:
 *
 * - `deleted` gana siempre. «Eliminar para todos» es un hecho consumado del
 *   lado de WhatsApp, no una etapa de la entrega: negarlo dejaría en pantalla
 *   un mensaje que ya no existe en el teléfono de nadie.
 * - `failed` solo puede pisar estados donde el mensaje **todavía no llegó**
 *   (`accepted`, `sent`). Un mensaje entregado o leído no puede fallar después,
 *   y un callback de error atrasado sobre uno leído es justo el caso que hay
 *   que descartar.
 * - Desde `failed` no se sale. Es terminal: si Meta ya dijo que no se pudo, un
 *   `delivered` posterior es un callback viejo de otro intento.
 *
 * Los dos empates terminales (`deleted` sobre `deleted`, `failed` sobre
 * `failed`) devuelven `true` y son inofensivos: el UPDATE escribe el mismo
 * valor que ya estaba. Los empates de la escala (`sent` sobre `sent`, etc.) se
 * rechazan porque `>` es estricto, y así el UPDATE reporta 0 filas y el
 * callback duplicado se distingue del que avanza.
 */
export function outranks(
  next: DeliveryStatus,
  prev: DeliveryStatus | null
): boolean {
  if (prev === null) return true
  if (next === "deleted") return true
  if (next === "failed")
    return prev !== "delivered" && prev !== "read" && prev !== "deleted"
  if (prev === "failed") return false
  return RANK[next] > RANK[prev]
}

/**
 * Los estados previos que `next` tiene permitido pisar, para que el caller
 * pueda guardar el UPDATE **sin leer primero**:
 *
 * ```ts
 * const allowed = overwritableBy(next)
 * await sql`
 *   update messages set delivery_status = ${next}
 *   where connected_page_id = ${pageId} and meta_message_id = ${wamid}
 *     and (delivery_status is null or delivery_status = any(${allowed}::text[]))
 * `
 * ```
 *
 * El select-then-update pierde la carrera: dos callbacks del mismo wamid leen
 * los dos el estado viejo y el que escribe último gana, aunque sea el atrasado.
 * Con el predicado adentro del UPDATE la comparación la hace Postgres sobre la
 * fila bloqueada y el atrasado toca 0 filas.
 *
 * Devuelve una **lista de valores** y no un fragmento `sql` porque el driver
 * HTTP de Neon no soporta `sql` anidado —eso es idiom de postgres.js— y
 * trataría el fragmento como un parámetro más (misma nota que
 * `lib/inbound/webhook-delivery.ts`). El `is null` va aparte porque `= any()`
 * nunca da verdadero contra NULL.
 *
 * `accepted` devuelve la lista vacía: es el primer estado de la escala, así que
 * solo puede escribirse sobre `null`. `= any('{}')` es falso para toda fila, que
 * es exactamente lo que se quiere.
 *
 * La tabla está escrita a mano y **no** derivada de `outranks`: derivarla haría
 * que el test de coherencia entre las dos formas de la regla —la de TypeScript
 * y la que viaja al UPDATE— no pudiera fallar nunca, y ese test es el motivo de
 * ser de este módulo. Escrita, se lee de un vistazo qué autoriza cada callback.
 */
const OVERWRITABLE_BY: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  accepted: [],
  sent: ["accepted"],
  delivered: ["accepted", "sent"],
  read: ["accepted", "sent", "delivered"],
  // Solo lo que todavía no llegó, más el propio `failed` (reescribe lo mismo).
  failed: ["accepted", "sent", "failed"],
  // El borrado gana contra todo.
  deleted: ["accepted", "sent", "delivered", "read", "failed", "deleted"],
}

export function overwritableBy(
  next: DeliveryStatus
): readonly DeliveryStatus[] {
  return OVERWRITABLE_BY[next]
}
