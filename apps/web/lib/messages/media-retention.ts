// Retención de la media de WhatsApp en R2 (migración 0017).
//
// El borrado a los 180 días lo hace una **lifecycle rule del bucket**, no
// código nuestro: cero jobs, cero cron, cero deletes. Eso deja un problema de
// consistencia: si además guardáramos `attachment_status = 'deleted'` en la
// fila cuando el objeto expira, habría dos relojes —el de R2 y el nuestro— y
// tarde o temprano se separan; la UI mostraría un adjunto que ya no está, o
// escondería uno que sí está.
//
// Por eso el estado que ve la UI se **deriva** de la edad de la fila en vez de
// almacenarse. Un solo reloj, el mismo `created_at` que R2 usa para contar, y
// nada que backfillear cuando cambie el plazo.
//
// Módulo puro y separado de la pantalla a propósito: los tests de esta app no
// corren `.tsx`, así que esta regla escrita dentro del componente del adjunto
// sería una regla sin red.

// TODO: mover a `lib/messages/message-enums.ts` cuando exista; ese archivo es
// el hogar de las uniones compartidas del canal y esta unión es la misma que el
// check `attachment_status in (...)` de la 0017.
/**
 * Los cinco estados de la 0017 y lo que significa cada uno. No son decorativos:
 * la UI los distingue y el contrato es este.
 *
 * - `pending`: encolado, todavía no descargado.
 * - `available`: está en R2.
 * - `failed`: lo intentamos y no se pudo, definitivamente.
 * - `deleted`: lo tuvimos y venció a los 180 días.
 * - `unavailable`: Meta nunca lo ofreció (historial de más de 14 días).
 *
 * `failed` y `unavailable` no son sinónimos y por eso son dos: en el primero la
 * culpa es nuestra o de la descarga, en el segundo no hubo nada que descargar.
 * Colapsarlos dejaría a soporte sin poder distinguir un bug de un límite de
 * Meta.
 */
export type AttachmentStatus =
  | "pending"
  | "available"
  | "failed"
  | "deleted"
  | "unavailable"

/** El catálogo completo, en el orden del check de la 0017. */
export const ATTACHMENT_STATUSES: readonly AttachmentStatus[] = [
  "pending",
  "available",
  "failed",
  "deleted",
  "unavailable",
]

/**
 * El plazo, igual para todos los planes. Es el mismo número que la lifecycle
 * rule del bucket y que el tope declarado en /privacy para
 * `pending_media_deletions`: si cambia, cambia en los tres lados juntos.
 */
export const MEDIA_RETENTION_DAYS = 180

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Edad en días **enteros**, redondeando hacia abajo.
 *
 * Entero y no fraccionario porque la lifecycle rule de R2 también razona en
 * días enteros: con fracciones, un objeto de 180 días y 3 horas sería 180.125 y
 * el corte caería en medio de un día que R2 todavía considera vigente.
 *
 * Una fila del futuro (reloj desfasado) da 0, no negativo: no existe un adjunto
 * más nuevo que ahora, y el negativo solo serviría para propagar el error.
 */
export function ageInDays(createdAt: Date, now: Date): number {
  const elapsed = now.getTime() - createdAt.getTime()
  if (elapsed <= 0) return 0
  return Math.floor(elapsed / MS_PER_DAY)
}

export type MediaRow = {
  attachment_status: AttachmentStatus
  created_at: Date
}

/**
 * El estado que la UI tiene que renderizar, derivado.
 *
 * Solo `available` se recalcula: es el único que puede vencer. Los otros cuatro
 * pasan intactos por edad que tengan, y eso es deliberado —un `failed` de hace
 * un año sigue siendo «lo intentamos y no se pudo», no «venció»; convertirlo en
 * `deleted` le contaría al cliente que tuvimos un archivo que nunca tuvimos.
 *
 * El corte es `>`, no `>=`: el día 180 es el último día de retención, así que
 * todavía está disponible; recién el 181 pasa a `deleted`.
 */
export function effectiveStatus(row: MediaRow, now: Date): AttachmentStatus {
  if (row.attachment_status !== "available") return row.attachment_status
  return ageInDays(row.created_at, now) > MEDIA_RETENTION_DAYS
    ? "deleted"
    : "available"
}
