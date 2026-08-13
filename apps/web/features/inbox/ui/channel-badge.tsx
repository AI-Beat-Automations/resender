import type { PageChannel } from "@/lib/pages/page-registry"
import { Badge } from "@workspace/ui/components/badge"

// Nombre visible de cada canal, en un mapa exhaustivo y no en un ternario: con
// dos canales el ternario todavía se leía, pero con tres pintaba «Messenger» a
// todo lo que no fuera Instagram —incluido WhatsApp— sin romper nada y sin que
// nadie lo notara hasta ver una fila mentir. El `Record<PageChannel, string>`
// convierte al cuarto canal en un error de compilación acá mismo.
const CHANNEL_LABEL: Record<PageChannel, string> = {
  messenger: "Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
}

// Mismo texto y misma variante que la tarjeta de Conexiones: con tres canales
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
      {CHANNEL_LABEL[channel]}
    </Badge>
  )
}
