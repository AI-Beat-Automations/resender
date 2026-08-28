import type { AppDict } from "@/content/i18n/app"
import type { PageChannel } from "@/lib/pages/page-registry"
import { Badge } from "@workspace/ui/components/badge"

// Mismo texto y misma variante que la tarjeta de Conexiones: con tres canales
// mezclados en el mismo log es el dato que ordena todo lo demás —qué superficie
// de Graph contesta, qué ventana de respuesta corre—, y sin él dos filas de
// cuentas distintas solo se distinguen por el id. Se achica a la densidad de la
// fila, donde el resto del renglón es mono de 10.5px.
//
// El nombre sale del catálogo del diccionario y no de un ternario: con
// `channel === "instagram" ? "Instagram" : "Messenger"` una conversación de
// WhatsApp se pintaba «Messenger» y nada fallaba — el canal nuevo caía en la
// rama de descarte. `t.channels.label` sigue siendo el mismo `Record`
// exhaustivo, así que la garantía no se pierde al traducirlo.
//
// El diccionario llega por prop y no por `useAppDict()` para que el badge siga
// siendo server component: lo dibujan los dos logs de Inbox, que son las listas
// más largas del producto, y volverlo cliente mandaría una isla por fila.
export function ChannelBadge({
  channel,
  t,
}: {
  channel: PageChannel
  t: AppDict
}) {
  return (
    <Badge
      variant="outline"
      className="h-4 shrink-0 px-1.5 text-[10px] font-normal"
    >
      {t.channels.label[channel]}
    </Badge>
  )
}
