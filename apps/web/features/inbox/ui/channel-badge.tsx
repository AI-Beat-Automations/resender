import type { PageChannel } from "@/lib/pages/page-registry"
import { Badge } from "@workspace/ui/components/badge"

// Mismo texto y misma variante que la tarjeta de Conexiones: con dos canales
// mezclados en el mismo log es el dato que ordena todo lo demás —qué superficie
// de Graph contesta, qué ventana de respuesta corre—, y sin él dos filas de
// cuentas distintas solo se distinguen por el id. Se achica a la densidad de la
// fila, donde el resto del renglón es mono de 10.5px.
export function ChannelBadge({ channel }: { channel: PageChannel }) {
  return (
    <Badge
      variant="outline"
      className="h-4 shrink-0 px-1.5 text-[10px] font-normal"
    >
      {channel === "instagram" ? "Instagram" : "Messenger"}
    </Badge>
  )
}
