import Image from "next/image"

import type { PageChannel } from "@/lib/pages/page-registry"
import { cn } from "@workspace/ui/lib/utils"

// Avatar de canal: el logo oficial de la marca a sangre en 40px, sin el cuadro
// gris del mock (`1e`/`1f`). Reusa los SVG de `public/brands` que ya pinta la
// landing, así la consola y el sitio muestran la misma marca. Server
// component: lo pintan tarjetas y estado vacío.
const BRAND_LOGO: Record<PageChannel, string> = {
  messenger: "/brands/facebook.svg",
  instagram: "/brands/instagram.svg",
  whatsapp: "/brands/whatsapp.svg",
}

export function ChannelAvatar({
  channel,
  muted = false,
  className,
}: {
  channel: PageChannel
  /** Desconectada: el logo se apaga a gris. */
  muted?: boolean
  className?: string
}) {
  return (
    <Image
      src={BRAND_LOGO[channel]}
      alt=""
      width={40}
      height={40}
      aria-hidden
      className={cn(
        "size-10 shrink-0",
        muted && "opacity-50 grayscale",
        className
      )}
    />
  )
}
