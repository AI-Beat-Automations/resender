import { CheckCheck } from "lucide-react"

import type { WhatsappCostTypeItem } from "@/content/i18n"
import { cn } from "@/lib/utils"

// Captura de WhatsApp hecha solo con CSS para /whatsapp-cost-calculator: marco
// de teléfono, barra del contacto, fondo beige y burbujas. Las burbujas `out`
// son del negocio; los botones son los de respuesta rápida de una plantilla.
export function WhatsappChatMock({
  business,
  chat,
  time,
}: {
  business: string
  chat: WhatsappCostTypeItem["chat"]
  time: string
}) {
  return (
    <div className="mx-auto w-full max-w-xs overflow-hidden rounded-[2rem] border-8 border-neutral-900 bg-neutral-900 shadow-xl">
      <div className="flex items-center gap-3 bg-[#008069] px-4 py-3 text-white">
        <div className="flex size-8 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
          {business.charAt(0)}
        </div>
        <span className="text-sm font-medium">{business}</span>
      </div>
      <div className="flex min-h-56 flex-col justify-end gap-2 bg-[#efeae2] bg-[radial-gradient(#d9d2c5_1px,transparent_1px)] [background-size:14px_14px] px-3 py-4">
        {chat.map((message) => (
          <div
            key={message.text}
            className={cn(
              "max-w-[85%]",
              message.from === "out" ? "self-end" : "self-start"
            )}
          >
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-[13px] leading-5 text-neutral-900 shadow-sm",
                message.from === "out"
                  ? "rounded-tr-none bg-[#d9fdd3]"
                  : "rounded-tl-none bg-white"
              )}
            >
              <p>{message.text}</p>
              <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-neutral-500">
                {time}
                {message.from === "out" ? (
                  <CheckCheck className="size-3 text-sky-500" />
                ) : null}
              </span>
            </div>
            {message.buttons?.map((button) => (
              <div
                key={button}
                className="mt-1 rounded-lg bg-white py-2 text-center text-[13px] font-medium text-[#027eb5] shadow-sm"
              >
                {button}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
