"use client"

import * as React from "react"
import { Check, Loader2 } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

// Diagrama animado del recorrido de un mensaje (hero). Secuencia en loop:
// 1) entra el mensaje del cliente (burbuja con piquito al costado, izquierda),
// 2) el nodo de tu automatización "carga" (spinner) y termina en tilde,
// 3) sale tu respuesta (burbuja con piquito al costado, derecha — POV del cliente
// de Resender). El nodo va centrado. Sin flechas ni etiquetas entre pasos.
//
// El panel es una superficie blanca en ambos temas; el contenido usa la paleta
// clara fija (los tokens se invierten en dark). El violeta (primary) es igual.
const LIGHT_BORDER = "#d4cfc7"
const DARK_TEXT = "#242029"
const MUTED_TEXT = "#6b6780"

// Tiempos de la secuencia (ms). El contenedor se remonta cada ciclo.
const T = {
  msgIn: 400,
  node: 1500,
  spin: 900, // dura la vuelta del spinner antes de volverse tilde
  msgOut: 2900,
  cycle: 5600,
}

function Bubble({
  tone,
  animate,
  delay,
  children,
}: {
  tone: "in" | "out"
  animate: boolean
  delay: number
  children: React.ReactNode
}) {
  const isIn = tone === "in"
  const style: React.CSSProperties = {
    transformOrigin: isIn ? "left top" : "right top",
    ...(animate
      ? { animation: `msg-pop 400ms cubic-bezier(0.34,1.56,0.64,1) ${delay}ms both` }
      : {}),
  }
  return (
    <div className={cn("flex", !isIn && "justify-end")}>
      <div
        className={cn(
          "relative max-w-[80%] rounded-2xl border p-3 text-sm",
          isIn
            ? "border-green-200 bg-green-50 text-green-950"
            : "border-yellow-200 bg-yellow-50 text-yellow-950"
        )}
        style={style}
      >
        {children}
        {/* Piquito (tail) al costado, tipo WhatsApp: cuadrado rotado con borde
            en las dos caras externas (las internas se funden con la burbuja). */}
        <span
          className={cn(
            "absolute top-3 size-3 rotate-45 rounded-[1px]",
            isIn
              ? "-left-1.5 border-l border-t border-green-200 bg-green-50"
              : "-right-1.5 border-b border-r border-yellow-200 bg-yellow-50"
          )}
        />
      </div>
    </div>
  )
}

function Sequence({ animate }: { animate: boolean }) {
  return (
    <div className="flex flex-col gap-10 p-8">
      <Bubble tone="in" animate={animate} delay={T.msgIn}>
        Hola, ¿tienen turno para hoy?
      </Bubble>

      {/* Nodo de automatización: centrado, sin recuadro, sobre el color del panel. */}
      <div
        className="flex items-center justify-center gap-3"
        style={
          animate
            ? { animation: `node-pop 350ms ease-out ${T.node}ms both` }
            : undefined
        }
      >
        {/* Spinner que da una vuelta y se transforma en tilde. Sin animación
            (reduced-motion) se muestra directamente el tilde ("terminó"). */}
        <div className="relative size-5 shrink-0 text-primary">
          {animate ? (
            <>
              <Loader2
                className="absolute inset-0 size-5"
                style={{
                  animation: `spin-done ${T.spin}ms linear ${T.node}ms both`,
                }}
              />
              <Check
                className="absolute inset-0 size-5"
                style={{
                  animation: `check-pop 380ms ease-out ${T.node + T.spin - 120}ms both`,
                }}
              />
            </>
          ) : (
            <Check className="size-5" />
          )}
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

      <Bubble tone="out" animate={animate} delay={T.msgOut}>
        ¡Sí! Te espero hoy a las 15:00 👍
      </Bubble>
    </div>
  )
}

export function FlowMock() {
  const [cycle, setCycle] = React.useState(0)
  const [animate, setAnimate] = React.useState(false)

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return
    }
    // Activa animaciones solo en cliente (evita mismatch SSR). Intencional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimate(true)
    const id = setInterval(() => setCycle((c) => c + 1), T.cycle)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      className="overflow-hidden rounded-3xl border bg-white shadow-sm"
      style={{ borderColor: LIGHT_BORDER }}
    >
      {/* Chrome de ventana: semáforo + etiqueta. */}
      <div
        className="flex items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: LIGHT_BORDER }}
      >
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-3 rounded-full bg-red-400/80" />
          <span className="size-3 rounded-full bg-yellow-400/80" />
          <span className="size-3 rounded-full bg-green-400/80" />
        </div>
        <span className="ml-2 font-mono text-xs" style={{ color: MUTED_TEXT }}>
          message-flow
        </span>
      </div>

      {/* key={cycle}: remonta la secuencia para reproducir la animación en loop. */}
      <Sequence key={cycle} animate={animate} />
    </div>
  )
}
