import type { AppDict } from "@/content/i18n/app"
import type { PageChannel } from "@/lib/pages/page-registry"
import { cn } from "@/lib/utils"

// Píldora del canal (mock `1h`): borde, fondo de tarjeta y sin tinte. Con tres
// canales mezclados en el mismo log es el dato que ordena todo lo demás —qué
// superficie de Graph contesta, qué ventana de respuesta corre—, y sin él dos
// filas de cuentas distintas solo se distinguen por el id.
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
  size = "row",
  t,
}: {
  channel: PageChannel
  /** `row` (11px, en la fila) o `header` (11.5px, en la cabecera del hilo). */
  size?: "row" | "header"
  t: AppDict
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-border whitespace-nowrap",
        size === "row"
          ? "bg-card px-[7px] py-px text-[11px] text-muted-foreground"
          : "px-2 py-0.5 text-[11.5px] text-text-secondary"
      )}
    >
      {t.channels.label[channel]}
    </span>
  )
}
