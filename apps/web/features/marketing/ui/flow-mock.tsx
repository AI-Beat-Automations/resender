import { ArrowDown, Bot } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

// Diagrama simple del recorrido de un mensaje (para el hero): entra un mensaje →
// tu automatización genera la respuesta → sale por Messenger. Los dos saltos
// (violeta) son lo que hace Resender.
//
// El panel es una superficie blanca en AMBOS temas (el mismo blanco que tiene en
// modo claro), para que resalte sobre el fondo oscuro en dark en vez de perderse.
// Por eso el contenido usa colores fijos de la paleta clara (no los tokens, que
// se invierten en dark). El violeta (primary) es igual en ambos.
const LIGHT_BORDER = "#d4cfc7"
const LIGHT_MUTED = "#ebe4d6"
const DARK_TEXT = "#242029"
const MUTED_TEXT = "#6b6780"

function Bubble({
  tone,
  children,
}: {
  tone: "in" | "out"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 text-sm",
        tone === "in"
          ? "border-green-200 bg-green-50 text-green-950"
          : "border-yellow-200 bg-yellow-50 text-yellow-950"
      )}
    >
      {children}
    </div>
  )
}

// Salto entre pasos: flecha + qué hace Resender.
function Hop({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-2 py-3 pl-1 text-xs"
      style={{ color: MUTED_TEXT }}
    >
      <ArrowDown className="size-4 shrink-0 text-primary" />
      <span>{label}</span>
    </div>
  )
}

export function FlowMock() {
  return (
    <div
      className="overflow-hidden rounded-3xl border bg-white shadow-sm"
      style={{ borderColor: LIGHT_BORDER }}
    >
      {/* Chrome de ventana: semáforo + etiqueta, para el aire "app/editor". */}
      <div
        className="flex items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: LIGHT_BORDER }}
      >
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-3 rounded-full bg-red-400/80" />
          <span className="size-3 rounded-full bg-yellow-400/80" />
          <span className="size-3 rounded-full bg-green-400/80" />
        </div>
        <span
          className="ml-2 font-mono text-xs"
          style={{ color: MUTED_TEXT }}
        >
          message-flow
        </span>
      </div>

      <div className="p-6">
        <Bubble tone="in">Hola, ¿tienen turno para hoy?</Bubble>

      <Hop label="Resender lo reenvía a tu webhook" />

      <div
        className="flex items-center gap-3 rounded-2xl border p-4"
        style={{ borderColor: LIGHT_BORDER, backgroundColor: LIGHT_MUTED }}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="size-5" />
        </div>
        <div className="text-sm">
          <p className="font-medium" style={{ color: DARK_TEXT }}>
            Tu automatización
          </p>
          <p style={{ color: MUTED_TEXT }}>
            recibe el mensaje y genera la respuesta
          </p>
        </div>
      </div>

      <Hop label="Resender la entrega por Messenger" />

        <Bubble tone="out">¡Sí! Te espero hoy a las 15:00 👍</Bubble>
      </div>
    </div>
  )
}
