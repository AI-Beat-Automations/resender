import { AtSign, MessageCircle } from "lucide-react"

import type { PageChannel } from "@/lib/pages/page-registry"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"

// Avatar de canal (mock 1e/1f): cuadrado de 40 px sobre `muted`, con la «f» de
// Messenger o el icono del canal. Sin colores de marca: el mock los dibuja en
// neutro, así que van los tokens del tema. Lo comparten la tarjeta de conexión
// y las tarjetas del estado vacío; es un `Record` exhaustivo para que un canal
// nuevo no caiga en la rama de descarte de un ternario.
const CHANNEL_GLYPH: Record<PageChannel, React.ReactNode> = {
  messenger: (
    <span className="font-heading text-[18px] font-bold" aria-hidden>
      f
    </span>
  ),
  instagram: <AtSign className="size-[18px]" aria-hidden />,
  whatsapp: <MessageCircle className="size-[18px]" aria-hidden />,
}

export function ChannelAvatar({
  channel,
  muted = false,
  className,
}: {
  channel: PageChannel
  // Una conexión desconectada se apaga entera, avatar incluido.
  muted?: boolean
  className?: string
}) {
  return (
    <Avatar
      size="lg"
      className={cn("rounded-[10px] after:rounded-[10px]", className)}
    >
      <AvatarFallback
        className={cn(
          "rounded-[10px] bg-muted text-foreground",
          muted && "text-muted-foreground"
        )}
      >
        {CHANNEL_GLYPH[channel]}
      </AvatarFallback>
    </Avatar>
  )
}
