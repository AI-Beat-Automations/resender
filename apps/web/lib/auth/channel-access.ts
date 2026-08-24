import { getSql } from "@/lib/db"

import type { PageChannel } from "@/lib/pages/page-registry"

// Permiso por cuenta, canal por canal (ADR 0010). Instagram y WhatsApp están
// implementados pero Meta todavía no concedió el Advanced Access de ninguno de
// los dos, así que cada canal se abre para las cuentas que se aprueban a mano:
//   update users set instagram_enabled = true where email = '...';
//   update users set whatsapp_enabled  = true where email = '...';
//
// Son dos banderas y no una: son dos permisos distintos de Meta, se conceden
// por separado y un tenant puede tener uno sin el otro.
//
// Vive en su propio módulo y no en `lib/auth/waitlist.ts` a propósito: ese
// archivo está marcado para borrarse en cuanto se limpie el gate apagado de la
// 0011, y sumarle código nuevo lo volvería inmortal.
export type ChannelAccessRow = {
  instagram_enabled: boolean
  whatsapp_enabled: boolean
}

type MaybeRow = ChannelAccessRow | null | undefined

/**
 * El permiso de los tres canales resuelto de una vez. `messenger` no tiene
 * bandera y nunca la tuvo: es el canal con el que el producto nació y su
 * Advanced Access está concedido desde el principio.
 *
 * Es un mapa y no tres booleanos sueltos porque las pantallas necesitan los
 * tres a la vez, y una firma posicional —`(channel, instagramAccess)`— ya se
 * quedó corta una vez: al tercer canal habría que sumarle un tercer parámetro
 * que nadie recuerda ordenar bien.
 */
export type ChannelAccess = Record<PageChannel, boolean>

// Fail closed: una fila ausente —cuenta borrada con la sesión todavía viva— o
// una bandera ilegible se tratan como "sin acceso", nunca como puerta abierta.
// Es lo contrario del gate de la 0004, donde el `true` era el bloqueo: acá el
// `true` es el permiso, así que el default de la columna ya es el cierre.
export function hasInstagramAccess(row: MaybeRow): boolean {
  return row?.instagram_enabled === true
}

export function hasWhatsappAccess(row: MaybeRow): boolean {
  return row?.whatsapp_enabled === true
}

export function toChannelAccess(row: MaybeRow): ChannelAccess {
  return {
    messenger: true,
    instagram: hasInstagramAccess(row),
    whatsapp: hasWhatsappAccess(row),
  }
}

// Lectura viva contra la base y nunca desde el JWT, por la misma razón que
// `readAccessRow`: dar o quitar el permiso tiene que valer en el request
// siguiente sin obligar a nadie a volver a autenticarse.
async function readChannelAccessRow(userId: string): Promise<MaybeRow> {
  const sql = getSql()
  const [row] = await sql<ChannelAccessRow[]>`
    select instagram_enabled, whatsapp_enabled
    from users
    where id = ${userId}
    limit 1
  `

  return row
}

export async function resolveInstagramAccess(userId: string): Promise<boolean> {
  return hasInstagramAccess(await readChannelAccessRow(userId))
}

export async function resolveWhatsappAccess(userId: string): Promise<boolean> {
  return hasWhatsappAccess(await readChannelAccessRow(userId))
}

/**
 * Los tres permisos en una sola consulta. Lo usan las pantallas, que los
 * necesitan juntos; las rutas siguen preguntando por el canal que les toca,
 * para no leer de más en el camino caliente del webhook.
 */
export async function resolveChannelAccess(
  userId: string
): Promise<ChannelAccess> {
  return toChannelAccess(await readChannelAccessRow(userId))
}
