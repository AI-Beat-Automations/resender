import type { ChannelAccess } from "@/lib/auth/channel-access"

import type { PageChannel, PageStatus } from "./page-registry"

// Cómo se presenta cada canal en /connections una vez que Instagram tiene
// permiso por cuenta (ADR 0010). La regla se lee como una sola frase: no se
// ofrece lo que no se puede dar, pero no se esconde lo que ya tenías.
//
// Módulo puro —sin React, sin Next, sin DB— y no una función dentro de la
// pantalla: los tests de esta app no corren `.tsx`, así que una regla escrita
// en el componente sería una regla sin red.

/**
 * Si se invita a conectar el canal: el botón de la cabecera y la tarjeta del
 * estado vacío. Esconderlos **no** es un gate —`instagram/start` y
 * `whatsapp/start` comprueban el permiso por su cuenta y rebotan a quien llegue
 * con la URL a mano—, es no ofrecer lo que la ruta va a rechazar.
 *
 * El permiso es de un canal y no de la cuenta: Messenger se ofrece siempre,
 * aunque Instagram y WhatsApp estén cerrados para ese mismo tenant.
 *
 * Recibe el mapa entero y no un booleano suelto desde que son tres canales: la
 * firma vieja `(channel, instagramAccess)` obligaba a que el llamador supiera de
 * qué canal era ese booleano, y con dos banderas eso ya no se sostiene.
 */
export function offersChannel(
  channel: PageChannel,
  access: ChannelAccess
): boolean {
  return access[channel]
}

/**
 * Estado que muestra la tarjeta de una cuenta ya conectada. `no-access` es el
 * tercer eje que suma la 0010: `status` y `token_status` ya eran independientes
 * (ADR 0005), y ahora una cuenta puede estar activa, con el token válido y sin
 * permiso.
 */
export type ConnectionStatus = "active" | "no-access" | "disconnected"

export type ConnectionStatusBadge = {
  label: string
  variant: "success" | "warning" | "ghost"
}

export function resolveConnectionStatus(page: {
  channel: PageChannel
  status: PageStatus
  access: ChannelAccess
}): ConnectionStatus {
  // Una cuenta desconectada tampoco recibe tráfico, así que el permiso no le
  // cambia nada: «sin acceso» sería un segundo motivo para el mismo silencio.
  if (page.status !== "active") return "disconnected"
  if (!page.access[page.channel]) return "no-access"
  return "active"
}

/**
 * Una cuenta revocada no puede seguir diciendo «activa»: ese badge sobre una
 * cuenta que no envía ni recibe es justo el bug que el usuario reporta como «no
 * me llegan los DMs».
 *
 * Va en el tinte de aviso y no en el destructivo porque la conexión está bien
 * —el token es válido, la cuenta sigue suscrita—; en esta tarjeta el rojo ya
 * significa «Meta rechazó el token».
 */
export const CONNECTION_STATUS_BADGE: Record<
  ConnectionStatus,
  ConnectionStatusBadge
> = {
  active: { label: "activa", variant: "success" },
  "no-access": { label: "sin acceso", variant: "warning" },
  disconnected: { label: "desconectada", variant: "ghost" },
}
