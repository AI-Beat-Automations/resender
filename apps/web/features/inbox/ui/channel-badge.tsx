import { CHANNEL_LABEL } from "@/lib/pages/connection-display"
import type { PageChannel } from "@/lib/pages/page-registry"
import { Badge } from "@workspace/ui/components/badge"

// Mismo texto y misma variante que la tarjeta de Conexiones: con tres canales
// mezclados en el mismo log es el dato que ordena todo lo demás —qué superficie
// de Graph contesta, qué ventana de respuesta corre—, y sin él dos filas de
// cuentas distintas solo se distinguen por el id. Se achica a la densidad de la
// fila, donde el resto del renglón es mono de 10.5px.
//
// El nombre sale del catálogo compartido y no de un ternario: con
// `channel === "instagram" ? "Instagram" : "Messenger"` una conversación de
// WhatsApp se pintaba «Messenger» y nada fallaba — el canal nuevo caía en la
// rama de descarte.
export function ChannelBadge({ channel }: { channel: PageChannel }) {
  return (
    <Badge
      variant="outline"
      className="h-4 shrink-0 px-1.5 text-[10px] font-normal"
    >
      {CHANNEL_LABEL[channel]}
    </Badge>
  )
}
