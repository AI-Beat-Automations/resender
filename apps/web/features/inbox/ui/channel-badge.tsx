import type { AppDict } from "@/content/i18n/app"
import type { PageChannel } from "@/lib/pages/page-registry"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

// Mismo texto y misma variante que la tarjeta de Conexiones: con tres canales
// mezclados en el mismo log es el dato que ordena todo lo demás —qué superficie
// de Graph contesta, qué ventana de respuesta corre—, y sin él dos filas de
// cuentas distintas solo se distinguen por el id.
//
// El nombre sale del catálogo del diccionario y no de un ternario: con
// `channel === "instagram" ? "Instagram" : "Messenger"` una conversación de
// WhatsApp se pintaba «Messenger» y nada fallaba — el canal nuevo caía en la
// rama de descarte. `t.channels.label` sigue siendo el mismo `Record`
// exhaustivo, así que la garantía no se pierde al traducirlo.
//
// Píldora con borde y fondo blanco (mock 1h): la fila la usa a 11px y la
// cabecera del hilo la sube a 11.5px vía `className`.
//
// El diccionario llega por prop y no por `useAppDict()` para que el badge siga
// siendo server component: lo dibujan los dos logs de Inbox, que son las listas
// más largas del producto, y volverlo cliente mandaría una isla por fila.
export function ChannelBadge({
  channel,
  className,
  t,
}: {
  channel: PageChannel
  className?: string
  t: AppDict
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-auto shrink-0 rounded-full bg-card px-[7px] py-px text-[11px] font-normal text-[var(--text-body)]",
        className
      )}
    >
      {t.channels.label[channel]}
    </Badge>
  )
}
